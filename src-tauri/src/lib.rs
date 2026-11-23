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
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_menu_event(|app, event| {
            // Menu actions are handled by the UI.
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(build_menu(app.handle())?)?;

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
                when_done: "none".into(),
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
            commands::reorder_jobs,
            commands::disk_space,
            commands::set_when_done,
            commands::get_when_done,
            commands::reset_settings,
            commands::diagnostics,
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

/// Standard macOS menu bar. Custom items are forwarded to the UI as a
/// "menu" event carrying the item id. (Windows and Linux use in-app
/// keyboard shortcuts instead of a menu bar.)
#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let app_menu = SubmenuBuilder::new(app, "PullStream")
        .item(&item("about", "About PullStream", None)?)
        .item(&item("check-updates", "Check for Updates…", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new-download", "New Download", Some("CmdOrCtrl+N"))?)
        .item(&item("paste-download", "Paste Link and Fetch", Some("CmdOrCtrl+Shift+V"))?)
        .separator()
        .item(&item("open-folder", "Open Downloads Folder", Some("CmdOrCtrl+Shift+O"))?)
        .separator()
        .close_window()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("view-downloads", "Downloads", Some("CmdOrCtrl+1"))?)
        .item(&item("view-history", "History", Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item("find", "Search Downloads", Some("CmdOrCtrl+F"))?)
        .separator()
        .fullscreen()
        .build()?;
    let downloads = SubmenuBuilder::new(app, "Downloads")
        .item(&item("pause-all", "Pause All", Some("CmdOrCtrl+Alt+P"))?)
        .item(&item("resume-all", "Resume All", Some("CmdOrCtrl+Alt+R"))?)
        .item(&item("retry-failed", "Retry Failed", None)?)
        .separator()
        .item(&item("clear-finished", "Clear Finished", None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "PullStream Help", None)?)
        .item(&item("terms", "Terms & Conditions", None)?)
        .separator()
        .item(&item("diagnostics", "Copy Diagnostics", None)?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &downloads, &window, &help])
        .build()
}
