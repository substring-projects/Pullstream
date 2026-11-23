//! Tauri commands invoked from the React frontend.

use crate::manager::{emit_job, remove_temp_files, schedule, stop_running, AppState};
use crate::models::{
    now_ms, DownloadOptions, Job, JobStatus, MediaInfo, NewJob, Settings, ToolStatus,
};
use crate::tools::Tool;
use crate::ytdlp;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

fn settings_of(state: &State<'_, AppState>) -> Settings {
    state.lock().settings.clone()
}

fn validate_url(url: &str) -> CmdResult<String> {
    let url = url.trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(url.to_string())
    } else {
        Err("Please enter a valid http(s) link.".into())
    }
}

/// Make a string safe to use as a folder name on every OS.
fn sanitize_dir_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let mut out: String = trimmed.chars().take(120).collect();
    if out.is_empty() {
        out = "Playlist".into();
    }
    out
}

#[tauri::command]
pub fn get_jobs(state: State<'_, AppState>) -> Vec<Job> {
    let inner = state.lock();
    let mut jobs: Vec<Job> = inner.jobs.values().cloned().collect();
    jobs.sort_by_key(|j| j.created_at);
    jobs
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    settings_of(&state)
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> CmdResult<Settings> {
    {
        let mut inner = state.lock();
        inner.settings = settings.clone();
        inner.db.save_settings(&settings);
    }
    // A higher concurrency limit may let more queued jobs start.
    schedule(&app);
    Ok(settings)
}

#[tauri::command]
pub async fn tool_status(app: AppHandle, state: State<'_, AppState>) -> CmdResult<ToolStatus> {
    let s = settings_of(&state);
    Ok(ytdlp::tool_status(&app, &s).await)
}

#[tauri::command]
pub async fn update_ytdlp(app: AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    // Running downloads are using the files we're about to replace.
    if !state.lock().running.is_empty() {
        return Err("Pause or finish active downloads before updating yt-dlp.".into());
    }
    let s = settings_of(&state);
    ytdlp::update_ytdlp(&app, &s).await
}

/// Download & install tools. `tools` = ids ("yt-dlp", "ffmpeg", "deno");
/// empty = whatever is currently missing.
#[tauri::command]
pub async fn install_tools(
    app: AppHandle,
    state: State<'_, AppState>,
    tools: Vec<String>,
) -> CmdResult<ToolStatus> {
    if !state.lock().running.is_empty() && (tools.is_empty() || tools.iter().any(|t| t == "yt-dlp")) {
        return Err("Pause or finish active downloads first.".into());
    }
    let s = settings_of(&state);
    let wanted: Vec<Tool> = if tools.is_empty() {
        let st = ytdlp::tool_status(&app, &s).await;
        [(st.ytdlp.path.is_none(), Tool::YtDlp), (st.ffmpeg.path.is_none(), Tool::Ffmpeg), (st.deno.path.is_none(), Tool::Deno)]
            .into_iter()
            .filter_map(|(missing, t)| missing.then_some(t))
            .collect()
    } else {
        tools
            .iter()
            .filter_map(|t| match t.as_str() {
                "yt-dlp" => Some(Tool::YtDlp),
                "ffmpeg" => Some(Tool::Ffmpeg),
                "deno" => Some(Tool::Deno),
                _ => None,
            })
            .collect()
    };
    let result = crate::tools::install(&app, wanted).await;
    // Queued downloads were waiting for yt-dlp.
    schedule(&app);
    let status = ytdlp::tool_status(&app, &s).await;
    result.map(|_| status)
}

#[tauri::command]
pub async fn fetch_info(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    no_playlist: bool,
) -> CmdResult<MediaInfo> {
    let url = validate_url(&url)?;
    let s = settings_of(&state);
    ytdlp::get_info(&app, &s, &url, no_playlist).await
}

#[tauri::command]
pub fn add_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    items: Vec<NewJob>,
    options: DownloadOptions,
    output_dir: Option<String>,
) -> CmdResult<Vec<Job>> {
    let created = {
        let mut inner = state.lock();
        // A folder picked for this download wins over the default.
        let base = output_dir
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&inner.settings.download_dir));
        let subfolders = inner.settings.playlist_subfolder;
        let start = now_ms();
        let mut created = Vec::with_capacity(items.len());
        for (i, item) in items.into_iter().enumerate() {
            let url = validate_url(&item.url)?;
            let dir = match (&item.playlist_title, subfolders) {
                (Some(pl), true) => base.join(sanitize_dir_name(pl)),
                _ => base.clone(),
            };
            let job = Job {
                id: uuid::Uuid::new_v4().to_string(),
                title: item.title.unwrap_or_else(|| url.clone()),
                url,
                thumbnail: item.thumbnail,
                duration: item.duration,
                uploader: item.uploader,
                playlist_title: item.playlist_title,
                options: options.clone(),
                output_dir: dir.to_string_lossy().into_owned(),
                filename_prefix: item.filename_prefix,
                status: JobStatus::Queued,
                progress: 0.0,
                part: 0,
                speed: None,
                eta: None,
                downloaded_bytes: None,
                total_bytes: None,
                stage: None,
                file_path: None,
                error: None,
                // Keeps playlist order stable in the queue.
                created_at: start + i as i64,
                finished_at: None,
                temp_files: vec![],
            };
            inner.jobs.insert(job.id.clone(), job.clone());
            created.push(job);
        }
        inner.db.save_jobs(&created);
        created
    };
    for j in &created {
        emit_job(&app, j);
    }
    schedule(&app);
    Ok(created)
}

fn update_job<F: FnOnce(&mut Job)>(app: &AppHandle, state: &State<'_, AppState>, id: &str, f: F) {
    let snapshot = {
        let mut inner = state.lock();
        let Some(job) = inner.jobs.get_mut(id) else { return };
        f(job);
        let j = job.clone();
        inner.db.save_job(&j);
        j
    };
    emit_job(app, &snapshot);
}

#[tauri::command]
pub fn pause_job(app: AppHandle, state: State<'_, AppState>, id: String) {
    let was_running = stop_running(&mut state.lock(), &id, JobStatus::Paused);
    if !was_running {
        update_job(&app, &state, &id, |j| {
            if j.status == JobStatus::Queued {
                j.status = JobStatus::Paused;
            }
        });
    }
}

#[tauri::command]
pub fn resume_job(app: AppHandle, state: State<'_, AppState>, id: String) {
    update_job(&app, &state, &id, |j| {
        if matches!(
            j.status,
            JobStatus::Paused | JobStatus::Failed | JobStatus::Canceled
        ) {
            j.status = JobStatus::Queued;
            j.error = None;
            j.stage = None;
        }
    });
    schedule(&app);
}

#[tauri::command]
pub fn cancel_job(app: AppHandle, state: State<'_, AppState>, id: String) {
    let was_running = stop_running(&mut state.lock(), &id, JobStatus::Canceled);
    if !was_running {
        update_job(&app, &state, &id, |j| {
            if !matches!(j.status, JobStatus::Completed) {
                j.status = JobStatus::Canceled;
                j.progress = 0.0;
                remove_temp_files(j);
                j.temp_files.clear();
            }
        });
    }
}

#[tauri::command]
pub fn pause_all(app: AppHandle, state: State<'_, AppState>) {
    let ids: Vec<(String, JobStatus)> = state
        .lock()
        .jobs
        .values()
        .map(|j| (j.id.clone(), j.status))
        .collect();
    for (id, status) in ids {
        if status == JobStatus::Queued || status.is_active() {
            pause_job(app.clone(), state.clone(), id);
        }
    }
}

#[tauri::command]
pub fn resume_all(app: AppHandle, state: State<'_, AppState>) {
    let snapshots: Vec<Job> = {
        let mut inner = state.lock();
        let mut changed = Vec::new();
        for j in inner.jobs.values_mut() {
            if j.status == JobStatus::Paused {
                j.status = JobStatus::Queued;
                changed.push(j.clone());
            }
        }
        inner.db.save_jobs(&changed);
        changed
    };
    for j in &snapshots {
        emit_job(&app, j);
    }
    schedule(&app);
}

#[tauri::command]
pub fn retry_failed(app: AppHandle, state: State<'_, AppState>) {
    let snapshots: Vec<Job> = {
        let mut inner = state.lock();
        let mut changed = Vec::new();
        for j in inner.jobs.values_mut() {
            if j.status == JobStatus::Failed {
                j.status = JobStatus::Queued;
                j.error = None;
                changed.push(j.clone());
            }
        }
        inner.db.save_jobs(&changed);
        changed
    };
    for j in &snapshots {
        emit_job(&app, j);
    }
    schedule(&app);
}

/// Remove jobs from the list. Running jobs are canceled first.
#[tauri::command]
pub fn remove_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
    ids: Vec<String>,
    delete_files: bool,
) {
    let mut inner = state.lock();
    let mut removed = Vec::new();
    for id in &ids {
        stop_running(&mut inner, id, JobStatus::Canceled);
        if let Some(job) = inner.jobs.remove(id) {
            remove_temp_files(&job);
            if delete_files {
                if let Some(p) = &job.file_path {
                    let _ = std::fs::remove_file(p);
                }
            }
            removed.push(id.clone());
        }
    }
    inner.db.delete_jobs(&removed);
    drop(inner);
    let _ = app.emit("jobs-removed", &removed);
}

#[tauri::command]
pub fn clear_finished(app: AppHandle, state: State<'_, AppState>) {
    let ids: Vec<String> = state
        .lock()
        .jobs
        .values()
        .filter(|j| matches!(j.status, JobStatus::Completed | JobStatus::Canceled))
        .map(|j| j.id.clone())
        .collect();
    remove_jobs(app, state, ids, false);
}

fn job_file(state: &State<'_, AppState>, id: &str) -> CmdResult<(Option<String>, String)> {
    let inner = state.lock();
    let job = inner.jobs.get(id).ok_or("Download not found")?;
    Ok((job.file_path.clone(), job.output_dir.clone()))
}

#[tauri::command]
pub fn open_file(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let (file, _) = job_file(&state, &id)?;
    let file = file.ok_or("File path unknown")?;
    if !std::path::Path::new(&file).exists() {
        return Err("The file was moved or deleted.".into());
    }
    app.opener()
        .open_path(file, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_file(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let (file, dir) = job_file(&state, &id)?;
    match file.filter(|f| std::path::Path::new(f).exists()) {
        Some(f) => app.opener().reveal_item_in_dir(f).map_err(|e| e.to_string()),
        None => {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            app.opener()
                .open_path(dir, None::<&str>)
                .map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
pub fn open_download_dir(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let dir = state.lock().settings.download_dir.clone();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Reorder waiting downloads. `ids` is the desired order; their existing
/// queue positions (created_at values) are reassigned in that order, so
/// jobs not listed keep their place.
#[tauri::command]
pub fn reorder_jobs(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>) {
    let snapshots = {
        let mut inner = state.lock();
        let mut slots: Vec<i64> = ids
            .iter()
            .filter_map(|id| inner.jobs.get(id).map(|j| j.created_at))
            .collect();
        slots.sort_unstable();
        let mut changed = Vec::new();
        for (id, slot) in ids.iter().zip(slots) {
            if let Some(j) = inner.jobs.get_mut(id) {
                if j.created_at != slot {
                    j.created_at = slot;
                    changed.push(j.clone());
                }
            }
        }
        inner.db.save_jobs(&changed);
        changed
    };
    for j in &snapshots {
        emit_job(&app, j);
    }
}

/// Free space (bytes) on the volume holding `path` (or the download folder).
#[tauri::command]
pub fn disk_space(state: State<'_, AppState>, path: Option<String>) -> Option<u64> {
    let mut p = PathBuf::from(path.unwrap_or_else(|| state.lock().settings.download_dir.clone()));
    // The folder may not exist yet; walk up to an existing ancestor.
    while !p.exists() {
        if !p.pop() {
            return None;
        }
    }
    fs2::available_space(&p).ok()
}

#[tauri::command]
pub fn set_when_done(state: State<'_, AppState>, action: String) {
    let action = match action.as_str() {
        "quit" | "sleep" => action,
        _ => "none".into(),
    };
    state.lock().when_done = action;
}

#[tauri::command]
pub fn get_when_done(state: State<'_, AppState>) -> String {
    state.lock().when_done.clone()
}

/// Restore default settings, keeping the download folder and tool paths.
#[tauri::command]
pub fn reset_settings(app: AppHandle, state: State<'_, AppState>) -> Settings {
    let settings = {
        let mut inner = state.lock();
        let old = inner.settings.clone();
        let fresh = Settings {
            download_dir: old.download_dir,
            ytdlp_path: old.ytdlp_path,
            ffmpeg_path: old.ffmpeg_path,
            ..Settings::default()
        };
        inner.settings = fresh.clone();
        inner.db.save_settings(&fresh);
        fresh
    };
    schedule(&app);
    settings
}

/// Plain-text report for support requests. Contains no URLs of what the
/// user downloaded, only versions, settings and recent error messages.
#[tauri::command]
pub async fn diagnostics(app: AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    let s = settings_of(&state);
    let tools = ytdlp::tool_status(&app, &s).await;
    let (counts, errors) = {
        let inner = state.lock();
        let mut counts: std::collections::BTreeMap<&'static str, usize> = Default::default();
        for j in inner.jobs.values() {
            let k = match j.status {
                JobStatus::Completed => "completed",
                JobStatus::Failed => "failed",
                JobStatus::Paused => "paused",
                JobStatus::Canceled => "canceled",
                JobStatus::Queued => "queued",
                _ => "active",
            };
            *counts.entry(k).or_default() += 1;
        }
        let mut failed: Vec<&Job> = inner
            .jobs
            .values()
            .filter(|j| j.status == JobStatus::Failed)
            .collect();
        failed.sort_by_key(|j| std::cmp::Reverse(j.finished_at.unwrap_or(j.created_at)));
        let errors: Vec<String> = failed
            .iter()
            .take(5)
            .filter_map(|j| j.error.clone())
            .map(|e| e.lines().next().unwrap_or("").chars().take(200).collect())
            .collect();
        (counts, errors)
    };
    let tool = |name: &str, t: &crate::models::ToolInfo| {
        format!(
            "{name}: {} ({})",
            t.version.as_deref().unwrap_or("missing"),
            t.source.as_deref().unwrap_or("-")
        )
    };
    let mut out = vec![
        format!("PullStream {}", app.package_info().version),
        format!("OS: {} {}", std::env::consts::OS, std::env::consts::ARCH),
        tool("yt-dlp", &tools.ytdlp),
        tool("ffmpeg", &tools.ffmpeg),
        tool("deno", &tools.deno),
        format!(
            "Settings: parallel={} fragments={} quality={:?} audio={} cookies={} rate_limit={}",
            s.max_concurrent,
            s.concurrent_fragments,
            s.default_max_height,
            s.audio_format,
            s.cookies_browser,
            if s.rate_limit.is_empty() { "none" } else { &s.rate_limit }
        ),
        format!("Jobs: {counts:?}"),
    ];
    if !errors.is_empty() {
        out.push("Recent errors:".into());
        out.extend(errors.into_iter().map(|e| format!("  - {e}")));
    }
    Ok(out.join("\n"))
}
