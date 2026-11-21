//! First-run installer for the tools PullStream needs (yt-dlp, ffmpeg + ffprobe,
//! deno). Keeps the installer small (~10 MB): tools are downloaded once from
//! their official release sources into the app data folder, SHA-256 verified,
//! unpacked and smoke-tested. The same code updates yt-dlp later.
//!
//! Layout (macOS: ~/Library/Application Support/com.pullstream.app/tools):
//!   tools/yt-dlp/yt-dlp[.exe] + _internal/   unpacked build, ~0.3 s startup
//!   tools/bin/ffmpeg, ffprobe, deno[.exe]

use crate::ytdlp::{exe_name, tools_bin_dir, tools_dir, version_of, ytdlp_install_dir};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const YTDLP: &str = "https://github.com/yt-dlp/yt-dlp/releases";
const DENO: &str = "https://github.com/denoland/deno/releases/latest/download";
const RIEDL: &str = "https://ffmpeg.martin-riedl.de/redirect/latest";
const GYAN: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tool {
    YtDlp,
    Ffmpeg, // installs ffmpeg + ffprobe
    Deno,
}

impl Tool {
    pub fn id(self) -> &'static str {
        match self {
            Tool::YtDlp => "yt-dlp",
            Tool::Ffmpeg => "ffmpeg",
            Tool::Deno => "deno",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    pub tool: &'static str,
    /// downloading | installing | done | error
    pub status: &'static str,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
}

fn emit(app: &AppHandle, p: SetupProgress) {
    let _ = app.emit("setup-progress", p);
}

// ---------------------------------------------------------------- platform

struct Platform {
    ytdlp: &'static str,
    deno: &'static str,
    /// martin-riedl.de path (macOS/Linux) — `None` on Windows (gyan.dev).
    riedl: Option<&'static str>,
}

fn platform() -> Result<Platform, String> {
    let p = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Platform { ytdlp: "yt-dlp_macos.zip", deno: "deno-aarch64-apple-darwin.zip", riedl: Some("macos/arm64") }
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Platform { ytdlp: "yt-dlp_macos.zip", deno: "deno-x86_64-apple-darwin.zip", riedl: Some("macos/amd64") }
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Platform { ytdlp: "yt-dlp_win.zip", deno: "deno-x86_64-pc-windows-msvc.zip", riedl: None }
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Platform { ytdlp: "yt-dlp_linux.zip", deno: "deno-x86_64-unknown-linux-gnu.zip", riedl: Some("linux/amd64") }
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Platform { ytdlp: "yt-dlp_linux_aarch64.zip", deno: "deno-aarch64-unknown-linux-gnu.zip", riedl: Some("linux/arm64") }
    } else {
        return Err("Automatic setup isn't available for this platform. Install yt-dlp, ffmpeg and deno manually.".into());
    };
    Ok(p)
}

// ---------------------------------------------------------------- helpers

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("PullStream-setup")
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let res = client.get(url).send().await.map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("HTTP {} for {url}", res.status()));
    }
    res.text().await.map_err(net_err)
}

fn net_err(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "Couldn't connect. Check your internet connection and try again.".into()
    } else {
        e.to_string()
    }
}

/// Hash for `file` in a "hash  name" listing; with `None`, the first hash.
fn pick_hash(listing: &str, file: Option<&str>) -> Result<String, String> {
    for line in listing.lines() {
        let mut parts = line.split_whitespace();
        let (Some(hash), name) = (parts.next(), parts.next()) else { continue };
        let is_hex = hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit());
        let name_ok = match (file, name) {
            (None, _) => true,
            (Some(f), Some(n)) => n.trim_start_matches('*').rsplit('/').next() == Some(f),
            _ => false,
        };
        if is_hex && name_ok {
            return Ok(hash.to_lowercase());
        }
    }
    Err(format!("No checksum published for {}", file.unwrap_or("download")))
}

/// Stream `url` to `dest`, hashing on the way and reporting progress.
/// Returns (final URL after redirects, sha256 hex).
async fn download(
    app: &AppHandle,
    client: &reqwest::Client,
    tool: Tool,
    url: &str,
    dest: &Path,
    offset: u64,
    grand_total: Option<u64>,
) -> Result<(String, String, u64), String> {
    let mut res = client.get(url).send().await.map_err(net_err)?;
    if !res.status().is_success() {
        return Err(format!("Download failed (HTTP {})", res.status()));
    }
    let final_url = res.url().to_string();
    let total = grand_total.or_else(|| res.content_length().map(|l| l + offset));
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut done = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(60), res.chunk())
            .await
            .map_err(|_| "Download stalled. Check your connection and try again.".to_string())?
            .map_err(net_err)?;
        let Some(chunk) = chunk else { break };
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| format!("Couldn't write file: {e}"))?;
        done += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(120) {
            last = Instant::now();
            emit(app, SetupProgress {
                tool: tool.id(),
                status: "downloading",
                downloaded: offset + done,
                total,
                message: None,
            });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok((final_url, format!("{:x}", hasher.finalize()), done))
}

fn check(actual: &str, expected: &str) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err("Checksum mismatch — the download may be corrupted or tampered with. Nothing was installed.".into())
    }
}

#[cfg(unix)]
fn make_executable(p: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())
}
#[cfg(not(unix))]
fn make_executable(_: &Path) -> Result<(), String> {
    Ok(())
}

/// Extract the single entry whose file name is `name` to `dest`.
fn extract_one(zip_path: &Path, name: &str, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let matches = entry
            .enclosed_name()
            .and_then(|p| p.file_name().map(|n| n == name))
            .unwrap_or(false);
        if entry.is_file() && matches {
            let tmp = dest.with_extension("part");
            let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            drop(out);
            make_executable(&tmp)?;
            std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{name} not found in the downloaded archive"))
}

fn scratch(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = tools_dir(app).ok_or("No app data folder")?.join(".downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

// ---------------------------------------------------------------- installers

/// `/releases/latest` redirects to `/releases/tag/<version>`.
pub async fn latest_ytdlp_tag(client: &reqwest::Client) -> Result<String, String> {
    let res = client.get(format!("{YTDLP}/latest")).send().await.map_err(net_err)?;
    res.url()
        .as_str()
        .rsplit_once("/tag/")
        .map(|(_, t)| t.trim_end_matches('/').to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "Couldn't determine the latest yt-dlp version".into())
}

async fn install_ytdlp(app: &AppHandle, client: &reqwest::Client, plat: &Platform) -> Result<String, String> {
    let tag = latest_ytdlp_tag(client).await?;
    let base = format!("{YTDLP}/download/{tag}");
    let sums = get_text(client, &format!("{base}/SHA2-256SUMS")).await?;
    let expected = pick_hash(&sums, Some(plat.ytdlp))?;

    let zip_path = scratch(app, plat.ytdlp)?;
    let (_, actual, _) = download(app, client, Tool::YtDlp, &format!("{base}/{}", plat.ytdlp), &zip_path, 0, None).await?;
    check(&actual, &expected)?;
    progress(app, Tool::YtDlp, "installing");

    let dir = ytdlp_install_dir(app).ok_or("No app data folder")?;
    let staging = dir.with_file_name("yt-dlp.new");
    let staging2 = staging.clone();
    let zip2 = zip_path.clone();
    let exe = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        let _ = std::fs::remove_dir_all(&staging2);
        std::fs::create_dir_all(&staging2).map_err(|e| e.to_string())?;
        let f = std::fs::File::open(&zip2).map_err(|e| e.to_string())?;
        zip::ZipArchive::new(f)
            .and_then(|mut a| a.extract(&staging2))
            .map_err(|e| format!("Unpacking yt-dlp failed: {e}"))?;
        // Normalise the launcher name (yt-dlp_macos, yt-dlp_linux, …).
        let launcher = std::fs::read_dir(&staging2)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .find(|n| n.starts_with("yt-dlp") && n != "_internal")
            .ok_or("Unexpected yt-dlp archive layout")?;
        let exe = staging2.join(exe_name("yt-dlp"));
        if staging2.join(&launcher) != exe {
            std::fs::rename(staging2.join(&launcher), &exe).map_err(|e| e.to_string())?;
        }
        make_executable(&exe)?;
        Ok(exe)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&zip_path);

    // Make sure it runs before switching over (first run also takes the
    // OS security scan, so the first real download starts fast).
    let version = version_of(app, &exe, "--version").await.ok_or_else(|| {
        let _ = std::fs::remove_dir_all(&staging);
        "The downloaded yt-dlp didn't start.".to_string()
    })?;
    let old = dir.with_file_name("yt-dlp.old");
    let _ = std::fs::remove_dir_all(&old);
    if dir.exists() {
        std::fs::rename(&dir, &old).map_err(|e| e.to_string())?;
    }
    if let Err(e) = std::fs::rename(&staging, &dir) {
        let _ = std::fs::rename(&old, &dir);
        return Err(format!("Installing yt-dlp failed: {e}"));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(version)
}

async fn install_deno(app: &AppHandle, client: &reqwest::Client, plat: &Platform) -> Result<String, String> {
    let sum = get_text(client, &format!("{DENO}/{}.sha256sum", plat.deno)).await?;
    let expected = pick_hash(&sum, None)?;
    let zip_path = scratch(app, plat.deno)?;
    let (_, actual, _) = download(app, client, Tool::Deno, &format!("{DENO}/{}", plat.deno), &zip_path, 0, None).await?;
    check(&actual, &expected)?;
    progress(app, Tool::Deno, "installing");
    let bin = tools_bin_dir(app).ok_or("No app data folder")?;
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let dest = bin.join(exe_name("deno"));
    let (z, d) = (zip_path.clone(), dest.clone());
    tauri::async_runtime::spawn_blocking(move || extract_one(&z, &exe_name("deno"), &d))
        .await
        .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&zip_path);
    version_of(app, &dest, "--version").await.ok_or_else(|| "deno didn't start".into())
}

async fn install_ffmpeg(app: &AppHandle, client: &reqwest::Client, plat: &Platform) -> Result<String, String> {
    let bin = tools_bin_dir(app).ok_or("No app data folder")?;
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;

    match plat.riedl {
        // macOS / Linux: separate static ffmpeg and ffprobe zips. The
        // "latest" redirect resolves to a versioned folder holding the checksum.
        Some(path) => {
            // Rough combined size so the bar covers both files.
            let mut offset = 0u64;
            for name in ["ffmpeg", "ffprobe"] {
                let zip_path = scratch(app, &format!("{name}.zip"))?;
                let (final_url, actual, size) = download(
                    app, client, Tool::Ffmpeg,
                    &format!("{RIEDL}/{path}/release/{name}.zip"),
                    &zip_path, offset, None,
                ).await?;
                offset += size;
                let sum = get_text(client, &format!("{final_url}.sha256")).await?;
                check(&actual, &pick_hash(&sum, None)?)?;
                let (z, d) = (zip_path.clone(), bin.join(name));
                tauri::async_runtime::spawn_blocking(move || extract_one(&z, name, &d))
                    .await
                    .map_err(|e| e.to_string())??;
                let _ = std::fs::remove_file(&zip_path);
            }
            progress(app, Tool::Ffmpeg, "installing");
        }
        // Windows: gyan.dev "essentials" release build (ffmpeg.exe + ffprobe.exe).
        None => {
            let sum = get_text(client, &format!("{GYAN}.sha256")).await?;
            let expected = pick_hash(&sum, None)?;
            let zip_path = scratch(app, "ffmpeg-essentials.zip")?;
            let (_, actual, _) = download(app, client, Tool::Ffmpeg, GYAN, &zip_path, 0, None).await?;
            check(&actual, &expected)?;
            progress(app, Tool::Ffmpeg, "installing");
            let (z, b) = (zip_path.clone(), bin.clone());
            tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                extract_one(&z, "ffmpeg.exe", &b.join("ffmpeg.exe"))?;
                extract_one(&z, "ffprobe.exe", &b.join("ffprobe.exe"))
            })
            .await
            .map_err(|e| e.to_string())??;
            let _ = std::fs::remove_file(&zip_path);
        }
    }
    let ffmpeg = bin.join(exe_name("ffmpeg"));
    let _ = version_of(app, &bin.join(exe_name("ffprobe")), "-version").await;
    version_of(app, &ffmpeg, "-version").await.ok_or_else(|| "ffmpeg didn't start".into())
}

fn progress(app: &AppHandle, tool: Tool, status: &'static str) {
    emit(app, SetupProgress { tool: tool.id(), status, downloaded: 0, total: None, message: None });
}

async fn run_one(app: &AppHandle, client: &reqwest::Client, plat: &Platform, tool: Tool) -> Result<(), String> {
    let result = match tool {
        Tool::YtDlp => install_ytdlp(app, client, plat).await,
        Tool::Ffmpeg => install_ffmpeg(app, client, plat).await,
        Tool::Deno => install_deno(app, client, plat).await,
    };
    match &result {
        Ok(version) => emit(app, SetupProgress {
            tool: tool.id(), status: "done", downloaded: 0, total: None, message: Some(version.clone()),
        }),
        Err(e) => emit(app, SetupProgress {
            tool: tool.id(), status: "error", downloaded: 0, total: None, message: Some(e.clone()),
        }),
    }
    result.map(|_| ())
}

/// Install the given tools in parallel. Errors are reported per tool via
/// events; the returned error summarises any failures.
pub async fn install(app: &AppHandle, tools: Vec<Tool>) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("Setup is already running.".into());
    }
    let result = async {
        let plat = platform()?;
        let client = client()?;
        let has = |t| tools.contains(&t);
        let (a, b, c) = tokio::join!(
            async { if has(Tool::YtDlp) { run_one(app, &client, &plat, Tool::YtDlp).await } else { Ok(()) } },
            async { if has(Tool::Ffmpeg) { run_one(app, &client, &plat, Tool::Ffmpeg).await } else { Ok(()) } },
            async { if has(Tool::Deno) { run_one(app, &client, &plat, Tool::Deno).await } else { Ok(()) } },
        );
        if let Some(dir) = tools_dir(app) {
            let _ = std::fs::remove_dir_all(dir.join(".downloads"));
        }
        let failed: Vec<&str> = [(a, "yt-dlp"), (b, "ffmpeg"), (c, "deno")]
            .into_iter()
            .filter_map(|(r, n)| r.err().map(|_| n))
            .collect();
        if failed.is_empty() {
            Ok(())
        } else {
            Err(format!("Couldn't install: {}", failed.join(", ")))
        }
    }
    .await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

/// Update PullStream's yt-dlp if a newer release exists.
pub async fn update_ytdlp(app: &AppHandle, current: &str) -> Result<String, String> {
    let tag = latest_ytdlp_tag(&client()?).await?;
    // Versions are dates (2026.10.26[.1]), so string order is version order.
    if !current.is_empty() && tag.as_str() <= current {
        return Ok(format!("yt-dlp is up to date ({current})"));
    }
    install(app, vec![Tool::YtDlp]).await?;
    Ok(format!("Updated yt-dlp to {tag}"))
}

#[cfg(test)]
mod tests {
    use super::pick_hash;

    #[test]
    fn picks_hashes() {
        let h = "a".repeat(64);
        let list = format!("{h}  yt-dlp_macos.zip\n{}  other.zip\n", "b".repeat(64));
        assert_eq!(pick_hash(&list, Some("yt-dlp_macos.zip")).unwrap(), h);
        assert_eq!(pick_hash(&format!("{h}  deno.zip"), None).unwrap(), h);
        assert_eq!(pick_hash(&format!("{h}\n"), None).unwrap(), h);
        assert!(pick_hash(&list, Some("missing.zip")).is_err());
    }
}
