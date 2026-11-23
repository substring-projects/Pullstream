use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Starting,
    Downloading,
    Processing,
    Completed,
    Failed,
    Paused,
    Canceled,
}

impl JobStatus {
    pub fn is_active(self) -> bool {
        matches!(
            self,
            JobStatus::Starting | JobStatus::Downloading | JobStatus::Processing
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Audio,
}

/// What the user asked for. Stored with the job so retries reproduce it exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub kind: MediaKind,
    /// Max video height (e.g. 1080). `None` = best available.
    pub max_height: Option<u32>,
    /// mp3 | m4a | opus | flac | wav (audio only)
    pub audio_format: String,
    /// Subtitle languages to embed (e.g. ["en", "hi"]). Empty = none.
    #[serde(default)]
    pub subtitle_langs: Vec<String>,
    /// Download only this part of the video, in seconds.
    #[serde(default)]
    pub section: Option<Section>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Section {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub playlist_title: Option<String>,
    pub options: DownloadOptions,
    pub output_dir: String,
    /// Prepended to the file name, e.g. "03 - " for playlist items.
    pub filename_prefix: Option<String>,
    pub status: JobStatus,
    /// 0..=100 for the current stream
    pub progress: f64,
    /// Which stream (1 = video, 2 = audio for merged formats)
    pub part: u32,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub stage: Option<String>,
    pub file_path: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    /// Partial-download paths, cleaned up on cancel.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub temp_files: Vec<String>,
}

/// Payload from the frontend to enqueue a download.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewJob {
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub playlist_title: Option<String>,
    pub filename_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: String,
    pub max_concurrent: u32,
    pub concurrent_fragments: u32,
    pub default_kind: MediaKind,
    pub default_max_height: Option<u32>,
    pub audio_format: String,
    pub embed_thumbnail: bool,
    pub embed_metadata: bool,
    pub embed_subtitles: bool,
    pub playlist_subfolder: bool,
    pub clipboard_watch: bool,
    pub notifications: bool,
    /// none | chrome | firefox | safari | edge | brave
    pub cookies_browser: String,
    pub rate_limit: String,
    pub ytdlp_path: String,
    pub ffmpeg_path: String,
    pub theme: String,
    /// system | en | hi
    pub language: String,
    pub sound_on_complete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            max_concurrent: 3,
            concurrent_fragments: 4,
            default_kind: MediaKind::Video,
            default_max_height: Some(1080),
            audio_format: "mp3".into(),
            embed_thumbnail: true,
            embed_metadata: true,
            embed_subtitles: false,
            playlist_subfolder: true,
            clipboard_watch: true,
            notifications: true,
            cookies_browser: "none".into(),
            rate_limit: String::new(),
            ytdlp_path: String::new(),
            ffmpeg_path: String::new(),
            theme: "system".into(),
            language: "system".into(),
            sound_on_complete: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityOption {
    pub height: u32,
    pub fps: Option<f64>,
    pub approx_size: Option<u64>,
    /// Best codec family at this height: H.264 | VP9 | AV1 | HEVC
    pub codec: Option<String>,
    pub hdr: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub lang: String,
    pub name: String,
    /// Auto-generated captions rather than uploaded subtitles.
    pub auto: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub url: String,
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MediaInfo {
    #[serde(rename_all = "camelCase")]
    Video {
        url: String,
        id: String,
        title: String,
        thumbnail: Option<String>,
        duration: Option<f64>,
        uploader: Option<String>,
        view_count: Option<u64>,
        extractor: String,
        qualities: Vec<QualityOption>,
        audio_size: Option<u64>,
        has_playlist: bool,
        subtitles: Vec<SubtitleTrack>,
    },
    #[serde(rename_all = "camelCase")]
    Playlist {
        url: String,
        title: String,
        uploader: Option<String>,
        thumbnail: Option<String>,
        entries: Vec<PlaylistEntry>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub path: Option<String>,
    pub version: Option<String>,
    /// custom | managed (installed by PullStream) | system
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub ytdlp: ToolInfo,
    pub ffmpeg: ToolInfo,
    pub deno: ToolInfo,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
