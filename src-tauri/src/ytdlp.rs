//! Everything that talks to the yt-dlp / ffmpeg binaries:
//! locating them, fetching metadata and building download arguments.

use crate::models::{
    Job, MediaInfo, MediaKind, PlaylistEntry, QualityOption, Settings, ToolInfo, ToolStatus,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

/// Fallback locations for system installs. GUI apps on macOS don't inherit
/// the shell PATH, so these must be listed explicitly.
const EXTRA_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/bin",
];

/// Where PullStream installs its tools (see tools.rs).
pub fn tools_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("tools"))
}
/// ffmpeg, ffprobe, deno.
pub fn tools_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    tools_dir(app).map(|d| d.join("bin"))
}
/// Unpacked yt-dlp build (launcher + _internal/).
pub fn ytdlp_install_dir(app: &AppHandle) -> Option<PathBuf> {
    tools_dir(app).map(|d| d.join("yt-dlp"))
}

/// Search order: PullStream's tools → system installs. Also used as PATH for
/// child processes so yt-dlp finds deno (needed for YouTube) and ffprobe.
fn search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    dirs.extend(tools_bin_dir(app));
    // QA switch (debug builds only): behave like a clean machine.
    if cfg!(debug_assertions) && std::env::var_os("PULLSTREAM_NO_SYSTEM_TOOLS").is_some() {
        return dirs;
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        for sub in [".deno/bin", ".local/bin"] {
            dirs.push(home.join(sub));
        }
    }
    if cfg!(not(windows)) {
        dirs.extend(EXTRA_DIRS.iter().map(PathBuf::from));
    }
    if let Some(p) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    dirs
}

pub fn augmented_path(app: &AppHandle) -> String {
    std::env::join_paths(search_dirs(app))
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn custom(override_path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(override_path.trim());
    (!override_path.trim().is_empty() && p.is_file()).then_some(p)
}

/// Resolve ffmpeg/ffprobe/deno: custom setting → PullStream's → system.
pub fn find_tool(app: &AppHandle, name: &str, override_path: &str) -> Option<PathBuf> {
    if let Some(p) = custom(override_path) {
        return Some(p);
    }
    let file = exe_name(name);
    search_dirs(app)
        .into_iter()
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
}

/// Resolve yt-dlp: custom setting → PullStream's → system.
pub fn find_ytdlp(app: &AppHandle, override_path: &str) -> Option<PathBuf> {
    if let Some(p) = custom(override_path) {
        return Some(p);
    }
    ytdlp_install_dir(app)
        .map(|d| d.join(exe_name("yt-dlp")))
        .filter(|p| p.is_file())
        .or_else(|| find_tool(app, "yt-dlp", ""))
}

fn source_of(app: &AppHandle, path: &Path, override_path: &str) -> &'static str {
    if custom(override_path).as_deref() == Some(path) {
        "custom"
    } else if tools_dir(app).is_some_and(|d| path.starts_with(d)) {
        "managed"
    } else {
        "system"
    }
}

pub fn base_command(app: &AppHandle, bin: &Path) -> Command {
    let mut cmd = Command::new(bin);
    cmd.env("PATH", augmented_path(app))
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn ytdlp(app: &AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    find_ytdlp(app, &settings.ytdlp_path).ok_or_else(|| {
        "yt-dlp isn't installed yet. Open Settings → Tools to install it."
            .to_string()
    })
}

fn cookie_args(settings: &Settings) -> Vec<String> {
    match settings.cookies_browser.as_str() {
        "" | "none" => vec![],
        b => vec!["--cookies-from-browser".into(), b.into()],
    }
}

pub async fn version_of(app: &AppHandle, bin: &Path, arg: &str) -> Option<String> {
    let out = base_command(app, bin).arg(arg).output().await.ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?.trim().to_string();
    (!first.is_empty()).then_some(first)
}

/// Start each tool once in the background so the OS's first-launch
/// security scan (several seconds on macOS) doesn't delay the first download.
pub async fn warm_up_tools(app: &AppHandle) {
    let mut tools: Vec<(PathBuf, &str)> = Vec::new();
    tools.extend(find_ytdlp(app, "").map(|p| (p, "--version")));
    for (name, arg) in [("ffmpeg", "-version"), ("ffprobe", "-version"), ("deno", "--version")] {
        tools.extend(find_tool(app, name, "").map(|p| (p, arg)));
    }
    let (a, b, c, d) = tokio::join!(
        warm(app, tools.first()),
        warm(app, tools.get(1)),
        warm(app, tools.get(2)),
        warm(app, tools.get(3)),
    );
    let _ = (a, b, c, d);
}

async fn warm(app: &AppHandle, tool: Option<&(PathBuf, &str)>) {
    if let Some((p, arg)) = tool {
        let _ = version_of(app, p, arg).await;
    }
}

pub async fn tool_status(app: &AppHandle, settings: &Settings) -> ToolStatus {
    async fn info(app: &AppHandle, path: Option<PathBuf>, override_path: &str, arg: &str) -> ToolInfo {
        match path {
            Some(p) => ToolInfo {
                version: version_of(app, &p, arg).await,
                source: Some(source_of(app, &p, override_path).to_string()),
                path: Some(p.to_string_lossy().into_owned()),
            },
            None => ToolInfo { path: None, version: None, source: None },
        }
    }
    let (ytdlp, ffmpeg, deno) = tokio::join!(
        info(app, find_ytdlp(app, &settings.ytdlp_path), &settings.ytdlp_path, "--version"),
        info(app, find_tool(app, "ffmpeg", &settings.ffmpeg_path), &settings.ffmpeg_path, "-version"),
        info(app, find_tool(app, "deno", ""), "", "--version"),
    );
    ToolStatus { ytdlp, ffmpeg, deno }
}

pub async fn update_ytdlp(app: &AppHandle, settings: &Settings) -> Result<String, String> {
    let bin = ytdlp(app, settings)?;
    match source_of(app, &bin, &settings.ytdlp_path) {
        "custom" => Err("A custom yt-dlp path is set. Update it yourself, or clear the path \
                         in Settings to use PullStream's copy."
            .into()),
        // System installs (e.g. Homebrew) can't be updated by us; install
        // PullStream's own copy, which then takes priority.
        "system" => crate::tools::update_ytdlp(app, "").await,
        _ => {
            let current = version_of(app, &bin, "--version").await.unwrap_or_default();
            crate::tools::update_ytdlp(app, &current).await
        }
    }
}

/// Fetch metadata. Playlists are fetched "flat" (no per-video extraction),
/// so even a 500-video playlist resolves in a second or two.
pub async fn get_info(
    app: &AppHandle,
    settings: &Settings,
    url: &str,
    no_playlist: bool,
) -> Result<MediaInfo, String> {
    let bin = ytdlp(app, settings)?;
    let mut cmd = base_command(app, &bin);
    cmd.args(["-J", "--flat-playlist", "--no-warnings", "--no-colors"]);
    if no_playlist {
        cmd.arg("--no-playlist");
    }
    cmd.args(cookie_args(settings));
    cmd.arg("--").arg(url);

    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(clean_error(&String::from_utf8_lossy(&out.stderr)));
    }
    let v: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("Could not parse yt-dlp output: {e}"))?;
    Ok(parse_info(url, &v))
}

pub fn clean_error(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with("ERROR:"))
        .collect();
    let msg = if lines.is_empty() {
        stderr.trim().lines().last().unwrap_or("Unknown error").to_string()
    } else {
        lines.join("\n")
    };
    msg.trim_start_matches("ERROR:").trim().to_string()
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_string)
}
fn f(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}
fn size_of(fmt: &Value) -> Option<u64> {
    fmt.get("filesize")
        .and_then(Value::as_u64)
        .or_else(|| fmt.get("filesize_approx").and_then(Value::as_u64))
}

fn parse_info(input_url: &str, v: &Value) -> MediaInfo {
    if v.get("_type").and_then(Value::as_str) == Some("playlist") {
        let entries = v
            .get("entries")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(parse_entry).collect())
            .unwrap_or_default();
        let thumbnail = v
            .get("thumbnails")
            .and_then(Value::as_array)
            .and_then(|t| t.last())
            .and_then(|t| s(t, "url"));
        return MediaInfo::Playlist {
            url: s(v, "webpage_url").unwrap_or_else(|| input_url.to_string()),
            title: s(v, "title").unwrap_or_else(|| "Playlist".into()),
            uploader: s(v, "uploader").or_else(|| s(v, "channel")),
            thumbnail,
            entries,
        };
    }

    let formats = v
        .get("formats")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut by_height: BTreeMap<u32, (Option<f64>, Option<u64>)> = BTreeMap::new();
    let mut audio_size: Option<u64> = None;
    for fmt in &formats {
        let vcodec = s(fmt, "vcodec").unwrap_or_default();
        let acodec = s(fmt, "acodec").unwrap_or_default();
        if vcodec != "none" && !vcodec.is_empty() {
            if let Some(h) = fmt.get("height").and_then(Value::as_u64) {
                let e = by_height.entry(h as u32).or_insert((None, None));
                if let Some(fps) = f(fmt, "fps") {
                    e.0 = Some(e.0.map_or(fps, |x: f64| x.max(fps)));
                }
                if let Some(sz) = size_of(fmt) {
                    e.1 = Some(e.1.map_or(sz, |x| x.max(sz)));
                }
            }
        } else if acodec != "none" && !acodec.is_empty() {
            if let Some(sz) = size_of(fmt) {
                audio_size = Some(audio_size.map_or(sz, |x| x.max(sz)));
            }
        }
    }
    let qualities = by_height
        .into_iter()
        .rev()
        .filter(|(h, _)| *h >= 144)
        .map(|(height, (fps, size))| QualityOption {
            height,
            fps,
            approx_size: size,
        })
        .collect();

    MediaInfo::Video {
        url: s(v, "webpage_url").unwrap_or_else(|| input_url.to_string()),
        id: s(v, "id").unwrap_or_default(),
        title: s(v, "title").unwrap_or_else(|| input_url.to_string()),
        thumbnail: s(v, "thumbnail"),
        duration: f(v, "duration"),
        uploader: s(v, "uploader").or_else(|| s(v, "channel")),
        view_count: v.get("view_count").and_then(Value::as_u64),
        extractor: s(v, "extractor_key").unwrap_or_default(),
        qualities,
        audio_size,
        has_playlist: input_url.contains("list="),
    }
}

fn parse_entry(e: &Value) -> Option<PlaylistEntry> {
    let title = s(e, "title").unwrap_or_default();
    if title == "[Private video]" || title == "[Deleted video]" {
        return None;
    }
    let id = s(e, "id").unwrap_or_default();
    let is_yt = s(e, "ie_key").as_deref() == Some("Youtube");
    let url = s(e, "url")
        .filter(|u| u.starts_with("http"))
        .or_else(|| s(e, "webpage_url"))
        .or_else(|| is_yt.then(|| format!("https://www.youtube.com/watch?v={id}")))?;
    // Small thumbnails keep long playlists light.
    let thumbnail = if is_yt && !id.is_empty() {
        Some(format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg"))
    } else {
        e.get("thumbnails")
            .and_then(Value::as_array)
            .and_then(|t| t.last())
            .and_then(|t| s(t, "url"))
    };
    Some(PlaylistEntry {
        url,
        title: if title.is_empty() { id.clone() } else { title },
        id,
        duration: f(e, "duration"),
        thumbnail,
        uploader: s(e, "uploader").or_else(|| s(e, "channel")),
    })
}

/// yt-dlp output templates treat `%` specially; literal text must escape it.
fn escape_template(s: &str) -> String {
    s.replace('%', "%%")
}

pub const DL_PREFIX: &str = "__DL__";
pub const PP_PREFIX: &str = "__PP__";
pub const META_PREFIX: &str = "__META__";
pub const FILE_PREFIX: &str = "__FILE__";

pub fn download_command(
    app: &AppHandle,
    settings: &Settings,
    job: &Job,
) -> Result<Command, String> {
    let bin = ytdlp(app, settings)?;
    let mut cmd = base_command(app, &bin);

    let prefix = job
        .filename_prefix
        .as_deref()
        .map(escape_template)
        .unwrap_or_default();
    let template = Path::new(&escape_template(&job.output_dir))
        .join(format!("{prefix}%(title).180B [%(id)s].%(ext)s"))
        .to_string_lossy()
        .into_owned();

    cmd.args([
        "--newline",
        "--no-colors",
        "--progress",
        "--no-simulate",
        "--no-playlist",
        "--no-mtime",
        "--retries",
        "10",
        "--fragment-retries",
        "10",
    ]);
    cmd.arg("--progress-template")
        .arg(format!("download:{DL_PREFIX}%(progress)j"));
    cmd.arg("--progress-template").arg(format!(
        "postprocess:{PP_PREFIX}%(progress.status)s|%(progress.postprocessor)s"
    ));
    cmd.arg("--print").arg(format!(
        "before_dl:{META_PREFIX}%(.{{title,thumbnail,duration,uploader}})j"
    ));
    cmd.arg("--print")
        .arg(format!("after_move:{FILE_PREFIX}%(filepath)s"));
    cmd.args(["-N", &settings.concurrent_fragments.clamp(1, 16).to_string()]);
    cmd.arg("-o").arg(template);

    if let Some(ff) = find_tool(app, "ffmpeg", &settings.ffmpeg_path) {
        cmd.arg("--ffmpeg-location").arg(ff);
    }
    if !settings.rate_limit.trim().is_empty() {
        cmd.args(["-r", settings.rate_limit.trim()]);
    }
    cmd.args(cookie_args(settings));
    if settings.embed_metadata {
        cmd.arg("--embed-metadata");
    }

    match job.options.kind {
        MediaKind::Video => {
            let sort = match job.options.max_height {
                Some(h) => format!("res:{h},ext:mp4:m4a"),
                None => "res,ext:mp4:m4a".into(),
            };
            cmd.args(["-f", "bv*+ba/b", "-S", &sort, "--merge-output-format", "mp4"]);
            if settings.embed_thumbnail {
                cmd.arg("--embed-thumbnail");
            }
            if settings.embed_subtitles {
                cmd.args(["--write-subs", "--embed-subs", "--sub-langs", "en.*,-live_chat"]);
            }
        }
        MediaKind::Audio => {
            let fmt = match job.options.audio_format.as_str() {
                "m4a" | "opus" | "flac" | "wav" | "mp3" => job.options.audio_format.as_str(),
                _ => "mp3",
            };
            cmd.args(["-f", "ba/b", "-x", "--audio-format", fmt, "--audio-quality", "0"]);
            if settings.embed_thumbnail && fmt != "wav" {
                cmd.arg("--embed-thumbnail");
            }
        }
    }

    cmd.arg("--").arg(&job.url);
    Ok(cmd)
}
