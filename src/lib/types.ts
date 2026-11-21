export type JobStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "paused"
  | "canceled";

export type MediaKind = "video" | "audio";

export interface DownloadOptions {
  kind: MediaKind;
  maxHeight: number | null;
  audioFormat: string;
}

export interface Job {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  playlistTitle: string | null;
  options: DownloadOptions;
  outputDir: string;
  filenamePrefix: string | null;
  status: JobStatus;
  progress: number;
  part: number;
  speed: number | null;
  eta: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  stage: string | null;
  filePath: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface NewJob {
  url: string;
  title?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  uploader?: string | null;
  playlistTitle?: string | null;
  filenamePrefix?: string | null;
}

export interface Settings {
  downloadDir: string;
  maxConcurrent: number;
  concurrentFragments: number;
  defaultKind: MediaKind;
  defaultMaxHeight: number | null;
  audioFormat: string;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  embedSubtitles: boolean;
  playlistSubfolder: boolean;
  clipboardWatch: boolean;
  notifications: boolean;
  cookiesBrowser: string;
  rateLimit: string;
  ytdlpPath: string;
  ffmpegPath: string;
  theme: "system" | "light" | "dark";
}

export interface QualityOption {
  height: number;
  fps: number | null;
  approxSize: number | null;
}

export interface PlaylistEntry {
  url: string;
  id: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
}

export type MediaInfo =
  | {
      type: "video";
      url: string;
      id: string;
      title: string;
      thumbnail: string | null;
      duration: number | null;
      uploader: string | null;
      viewCount: number | null;
      extractor: string;
      qualities: QualityOption[];
      audioSize: number | null;
      hasPlaylist: boolean;
    }
  | {
      type: "playlist";
      url: string;
      title: string;
      uploader: string | null;
      thumbnail: string | null;
      entries: PlaylistEntry[];
    };

export interface ToolInfo {
  path: string | null;
  version: string | null;
  source: "custom" | "managed" | "system" | null;
}

export interface ToolStatus {
  ytdlp: ToolInfo;
  ffmpeg: ToolInfo;
  deno: ToolInfo;
}

export type ToolId = "yt-dlp" | "ffmpeg" | "deno";

export interface SetupProgress {
  tool: ToolId;
  status: "downloading" | "installing" | "done" | "error";
  downloaded: number;
  total: number | null;
  message: string | null;
}

export const ACTIVE: JobStatus[] = ["starting", "downloading", "processing"];
export const isActive = (s: JobStatus) => ACTIVE.includes(s);
