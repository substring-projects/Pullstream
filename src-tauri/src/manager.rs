//! Job manager: owns all jobs, enforces the parallel-download limit and runs
//! one yt-dlp process per job. Each worker streams progress to the UI.

use crate::db::Db;
use crate::models::{now_ms, Job, JobStatus, MediaKind, Settings};
use crate::ytdlp::{self, DL_PREFIX, FILE_PREFIX, META_PREFIX, PP_PREFIX};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

/// Max UI updates per job while downloading (~6/s keeps the UI smooth even
/// with many parallel downloads).
const EMIT_INTERVAL: Duration = Duration::from_millis(160);

pub struct Running {
    pub pid: Option<u32>,
    /// Set when the user asks us to stop: the status to land on after exit.
    pub stop: Option<JobStatus>,
}

pub struct Inner {
    pub jobs: HashMap<String, Job>,
    pub running: HashMap<String, Running>,
    pub settings: Settings,
    pub db: Db,
    /// What to do when the queue empties: none | quit | sleep (session only).
    pub when_done: String,
}

pub struct AppState(pub Mutex<Inner>);

impl AppState {
    pub fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic inside a lock shouldn't brick the app.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn emit_job(app: &AppHandle, job: &Job) {
    let _ = app.emit("job-updated", job);
}

/// Start as many queued jobs as the concurrency limit allows.
pub fn schedule(app: &AppHandle) {
    let state = app.state::<AppState>();
    let to_start: Vec<Job> = {
        let mut inner = state.lock();
        // Jobs wait in the queue until setup has installed yt-dlp.
        if ytdlp::find_ytdlp(app, &inner.settings.ytdlp_path).is_none() {
            return;
        }
        let max = inner.settings.max_concurrent.clamp(1, 16) as usize;
        let free = max.saturating_sub(inner.running.len());
        if free == 0 {
            return;
        }
        let mut queued: Vec<(i64, String)> = inner
            .jobs
            .values()
            .filter(|j| j.status == JobStatus::Queued)
            .map(|j| (j.created_at, j.id.clone()))
            .collect();
        queued.sort();
        let mut started = Vec::new();
        for (_, id) in queued.into_iter().take(free) {
            inner.running.insert(id.clone(), Running { pid: None, stop: None });
            if let Some(job) = inner.jobs.get_mut(&id) {
                job.status = JobStatus::Starting;
                job.stage = Some("Starting…".into());
                job.error = None;
                started.push(job.clone());
            }
        }
        inner.db.save_jobs(&started);
        started
    };
    for job in to_start {
        emit_job(app, &job);
        let app = app.clone();
        tauri::async_runtime::spawn(async move { run_job(app, job.id).await });
    }
}

/// Ask a running job to stop; it lands on `target` (Paused or Canceled).
pub fn stop_running(inner: &mut Inner, id: &str, target: JobStatus) -> bool {
    if let Some(r) = inner.running.get_mut(id) {
        r.stop = Some(target);
        if let Some(pid) = r.pid {
            kill_tree(pid);
        }
        true
    } else {
        false
    }
}

pub fn kill_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        // The worker runs in its own process group, so this also stops
        // the ffmpeg children yt-dlp spawned.
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

pub fn kill_all(app: &AppHandle) {
    let state = app.state::<AppState>();
    let inner = state.lock();
    for r in inner.running.values() {
        if let Some(pid) = r.pid {
            kill_tree(pid);
        }
    }
}

pub fn remove_temp_files(job: &Job) {
    for f in &job.temp_files {
        let p = Path::new(f);
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(format!("{f}.ytdl"));
        // Fragment files: "<name>.part-Frag12" etc.
        if let (Some(dir), Some(name)) = (p.parent(), p.file_name()) {
            let name = name.to_string_lossy().into_owned();
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().into_owned();
                    if n.starts_with(&name) && n != name {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
        }
    }
}

fn pp_label(name: &str) -> String {
    match name {
        "Merger" => "Merging video & audio",
        "ExtractAudio" => "Converting audio",
        "EmbedThumbnail" => "Embedding thumbnail",
        "FFmpegMetadata" | "Metadata" => "Writing metadata",
        "EmbedSubtitle" => "Embedding subtitles",
        "MoveFiles" => "Finalizing",
        "FixupM3u8" | "FixupM4a" | "FixupStretched" | "FixupDuplicateMoov" => "Fixing container",
        other => other,
    }
    .to_string()
}

enum Line {
    Out(String),
    Err(String),
}

async fn run_job(app: AppHandle, id: String) {
    let state = app.state::<AppState>();
    let (job, settings) = {
        let inner = state.lock();
        match inner.jobs.get(&id) {
            Some(j) => (j.clone(), inner.settings.clone()),
            None => return,
        }
    };

    let result = execute(&app, &settings, job).await;

    // Decide the final status.
    let final_job = {
        let mut inner = state.lock();
        let stop = inner.running.remove(&id).and_then(|r| r.stop);
        let Some(job) = inner.jobs.get_mut(&id) else {
            return;
        };
        job.speed = None;
        job.eta = None;
        match (stop, result) {
            (Some(JobStatus::Canceled), _) => {
                job.status = JobStatus::Canceled;
                job.stage = None;
                job.progress = 0.0;
                remove_temp_files(job);
                job.temp_files.clear();
            }
            (Some(target), _) => {
                job.status = target;
                job.stage = None;
            }
            (None, Ok(())) => {
                job.status = JobStatus::Completed;
                job.progress = 100.0;
                job.stage = None;
                job.finished_at = Some(now_ms());
                job.temp_files.clear();
            }
            (None, Err(e)) => {
                job.status = JobStatus::Failed;
                job.stage = None;
                job.error = Some(e);
            }
        }
        let j = job.clone();
        inner.db.save_job(&j);
        j
    };
    emit_job(&app, &final_job);

    if settings.notifications
        && matches!(final_job.status, JobStatus::Completed | JobStatus::Failed)
    {
        notify(&app, &final_job);
    }
    schedule(&app);
    // Only a finished download (not a pause/cancel) can trigger quit/sleep.
    if matches!(final_job.status, JobStatus::Completed | JobStatus::Failed) {
        after_queue_drained(&app);
    }
}

/// Fire the "when finished" action once nothing is running or waiting.
fn after_queue_drained(app: &AppHandle) {
    let action = {
        let state = app.state::<AppState>();
        let mut inner = state.lock();
        let busy = !inner.running.is_empty()
            || inner.jobs.values().any(|j| j.status == JobStatus::Queued);
        if busy {
            return;
        }
        std::mem::replace(&mut inner.when_done, "none".into())
    };
    let _ = app.emit("queue-finished", &action);
    match action.as_str() {
        "quit" => {
            let app = app.clone();
            // Give the UI a moment to show the final state.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                app.exit(0);
            });
        }
        "sleep" => {
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                sleep_computer();
            });
        }
        _ => {}
    }
}

fn sleep_computer() {
    let (cmd, args): (&str, &[&str]) = if cfg!(target_os = "macos") {
        ("pmset", &["sleepnow"])
    } else if cfg!(windows) {
        ("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"])
    } else {
        ("systemctl", &["suspend"])
    };
    let _ = std::process::Command::new(cmd)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

fn notify(app: &AppHandle, job: &Job) {
    use tauri_plugin_notification::NotificationExt;
    // Skip when the window is focused; the UI already shows it.
    if let Some(w) = app.get_webview_window("main") {
        if w.is_focused().unwrap_or(false) {
            return;
        }
    }
    let (title, body) = match job.status {
        JobStatus::Completed => ("Download complete", job.title.clone()),
        _ => (
            "Download failed",
            format!("{} — {}", job.title, job.error.clone().unwrap_or_default()),
        ),
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Spawn yt-dlp and stream its output into job updates.
async fn execute(app: &AppHandle, settings: &Settings, job: Job) -> Result<(), String> {
    std::fs::create_dir_all(&job.output_dir)
        .map_err(|e| format!("Cannot create folder {}: {e}", job.output_dir))?;

    let mut cmd = ytdlp::download_command(app, settings, &job)?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start yt-dlp: {e}"))?;
    let state = app.state::<AppState>();
    {
        let mut inner = state.lock();
        match inner.running.get_mut(&job.id) {
            Some(r) => {
                r.pid = child.id();
                // Stop requested before the process existed.
                if r.stop.is_some() {
                    if let Some(pid) = r.pid {
                        kill_tree(pid);
                    }
                }
            }
            None => {
                let _ = child.start_kill();
            }
        }
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Line>();
    if let Some(out) = child.stdout.take() {
        let tx = tx.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(Line::Out(l));
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let tx = tx.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(Line::Err(l));
            }
        });
    }
    drop(tx);

    let mut last_emit = Instant::now() - EMIT_INTERVAL;
    let mut current_file: Option<String> = None;
    let mut errors: Vec<String> = Vec::new();
    let mut tail: Vec<String> = Vec::new();

    while let Some(line) = rx.recv().await {
        let (text, is_err) = match line {
            Line::Out(t) => (t, false),
            Line::Err(t) => (t, true),
        };
        let text = text.trim_end();

        if let Some(json) = text.strip_prefix(DL_PREFIX) {
            let Ok(p) = serde_json::from_str::<Value>(json) else { continue };
            let status = p.get("status").and_then(Value::as_str).unwrap_or("");
            let filename = p.get("filename").and_then(Value::as_str).map(str::to_string);
            let tmp = p.get("tmpfilename").and_then(Value::as_str).map(str::to_string);
            let downloaded = p.get("downloaded_bytes").and_then(Value::as_u64);
            let total = p
                .get("total_bytes")
                .and_then(Value::as_u64)
                .or_else(|| p.get("total_bytes_estimate").and_then(Value::as_f64).map(|x| x as u64));
            let new_file = filename.is_some() && filename != current_file;
            if new_file {
                current_file = filename.clone();
            }
            let force = new_file || status == "finished";
            if !force && last_emit.elapsed() < EMIT_INTERVAL {
                continue;
            }
            last_emit = Instant::now();

            let mut inner = state.lock();
            let Some(j) = inner.jobs.get_mut(&job.id) else { continue };
            if new_file {
                j.part = if j.status == JobStatus::Downloading { j.part + 1 } else { 1 };
                if let Some(t) = tmp {
                    if !j.temp_files.contains(&t) {
                        j.temp_files.push(t);
                    }
                }
            }
            j.status = JobStatus::Downloading;
            j.downloaded_bytes = downloaded;
            j.total_bytes = total;
            j.speed = p.get("speed").and_then(Value::as_f64);
            j.eta = p.get("eta").and_then(Value::as_f64);
            j.progress = if status == "finished" {
                100.0
            } else {
                match (downloaded, total) {
                    (Some(d), Some(t)) if t > 0 => (d as f64 / t as f64 * 100.0).min(100.0),
                    _ => p.get("_percent").and_then(Value::as_f64).unwrap_or(j.progress),
                }
            };
            j.stage = Some(match (j.options.kind, j.part) {
                (MediaKind::Video, 2) => "Downloading audio".into(),
                (MediaKind::Video, p) if p > 2 => format!("Downloading part {p}"),
                _ => "Downloading".into(),
            });
            let snapshot = j.clone();
            if new_file {
                inner.db.save_job(&snapshot);
            }
            drop(inner);
            emit_job(app, &snapshot);
        } else if let Some(rest) = text.strip_prefix(PP_PREFIX) {
            let mut parts = rest.splitn(2, '|');
            let status = parts.next().unwrap_or("");
            let name = parts.next().unwrap_or("");
            if status != "started" {
                continue;
            }
            let mut inner = state.lock();
            if let Some(j) = inner.jobs.get_mut(&job.id) {
                j.status = JobStatus::Processing;
                j.stage = Some(pp_label(name));
                j.speed = None;
                j.eta = None;
                let snapshot = j.clone();
                drop(inner);
                emit_job(app, &snapshot);
            }
        } else if let Some(json) = text.strip_prefix(META_PREFIX) {
            let Ok(m) = serde_json::from_str::<Value>(json) else { continue };
            let mut inner = state.lock();
            if let Some(j) = inner.jobs.get_mut(&job.id) {
                if let Some(t) = m.get("title").and_then(Value::as_str) {
                    if j.title.is_empty() || j.title == j.url {
                        j.title = t.to_string();
                    }
                }
                if j.thumbnail.is_none() {
                    j.thumbnail = m.get("thumbnail").and_then(Value::as_str).map(str::to_string);
                }
                if j.duration.is_none() {
                    j.duration = m.get("duration").and_then(Value::as_f64);
                }
                if j.uploader.is_none() {
                    j.uploader = m.get("uploader").and_then(Value::as_str).map(str::to_string);
                }
                let snapshot = j.clone();
                inner.db.save_job(&snapshot);
                drop(inner);
                emit_job(app, &snapshot);
            }
        } else if let Some(path) = text.strip_prefix(FILE_PREFIX) {
            let mut inner = state.lock();
            if let Some(j) = inner.jobs.get_mut(&job.id) {
                j.file_path = Some(path.to_string());
            }
        } else if is_err {
            if text.starts_with("ERROR:") {
                errors.push(text.trim_start_matches("ERROR:").trim().to_string());
            } else if !text.is_empty() {
                tail.push(text.to_string());
                if tail.len() > 8 {
                    tail.remove(0);
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else if !errors.is_empty() {
        Err(errors.join("\n"))
    } else if let Some(last) = tail.last() {
        Err(last.clone())
    } else {
        Err(format!("yt-dlp exited with {status}"))
    }
}
