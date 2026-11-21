mod commands;
mod db;
mod manager;
mod models;
mod tools;
mod ytdlp;

use manager::{AppState, Inner};
use models::JobStatus;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            migrate_from_vidflow(&data_dir);
            std::fs::create_dir_all(&data_dir)?;
            let mut db = db::Db::open(&data_dir.join("pullstream.db"))?;

            let mut settings = db.load_settings().unwrap_or_default();
            if settings.download_dir.trim().is_empty() {
                let base = app
                    .path()
                    .download_dir()
                    .or_else(|_| app.path().home_dir())?;
                settings.download_dir = base.join("PullStream").to_string_lossy().into_owned();
                db.save_settings(&settings);
            }

            // Downloads interrupted by quitting are re-queued; yt-dlp resumes
            // from the partial files.
            let mut jobs = HashMap::new();
            let mut requeued = Vec::new();
            for mut job in db.load_jobs() {
                if job.status.is_active() {
                    job.status = JobStatus::Queued;
                    job.speed = None;
                    job.eta = None;
                    job.stage = None;
                    requeued.push(job.clone());
                }
                jobs.insert(job.id.clone(), job);
            }
            db.save_jobs(&requeued);

            app.manage(AppState(Mutex::new(Inner {
                jobs,
                running: HashMap::new(),
                settings,
                db,
            })));
            // Tool housekeeping runs in the background; queued jobs start
            // as soon as a stale yt-dlp update (if any) is cleared.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // QA switch (debug builds only): run setup without the UI.
                #[cfg(debug_assertions)]
                if std::env::var_os("PULLSTREAM_AUTO_SETUP").is_some() {
                    let all = vec![tools::Tool::YtDlp, tools::Tool::Ffmpeg, tools::Tool::Deno];
                    eprintln!("[auto-setup] {:?}", tools::install(&handle, all).await);
                }
                manager::schedule(&handle);
                ytdlp::warm_up_tools(&handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_jobs,
            commands::get_settings,
            commands::save_settings,
            commands::tool_status,
            commands::update_ytdlp,
            commands::install_tools,
            commands::fetch_info,
            commands::add_downloads,
            commands::pause_job,
            commands::resume_job,
            commands::cancel_job,
            commands::pause_all,
            commands::resume_all,
            commands::retry_failed,
            commands::remove_jobs,
            commands::clear_finished,
            commands::open_file,
            commands::reveal_file,
            commands::open_download_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building PullStream")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                manager::kill_all(app);
            }
        });
}


/// The app was called VidFlow before. Move its data folder (queue, history,
/// settings, installed tools) to the new identifier once, so nothing is lost.
fn migrate_from_vidflow(data_dir: &std::path::Path) {
    let Some(old) = data_dir.parent().map(|p| p.join("com.vidflow.app")) else { return };
    if data_dir.exists() || !old.is_dir() {
        return;
    }
    if std::fs::rename(&old, data_dir).is_err() {
        return; // e.g. different volume; the app simply starts fresh
    }
    for suffix in ["", "-wal", "-shm"] {
        let from = data_dir.join(format!("vidflow.db{suffix}"));
        if from.exists() {
            let _ = std::fs::rename(&from, data_dir.join(format!("pullstream.db{suffix}")));
        }
    }
}
