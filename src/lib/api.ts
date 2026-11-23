import { invoke } from "@tauri-apps/api/core";
import type {
  DownloadOptions,
  Job,
  MediaInfo,
  NewJob,
  Settings,
  ToolStatus,
} from "./types";

export type WhenDone = "none" | "quit" | "sleep";

/** Typed wrappers around the Rust commands. */
export const api = {
  getJobs: () => invoke<Job[]>("get_jobs"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  toolStatus: () => invoke<ToolStatus>("tool_status"),
  updateYtdlp: () => invoke<string>("update_ytdlp"),
  /** Empty list = install whatever is missing. */
  installTools: (tools: string[] = []) => invoke<ToolStatus>("install_tools", { tools }),
  fetchInfo: (url: string, noPlaylist = false) =>
    invoke<MediaInfo>("fetch_info", { url, noPlaylist }),
  addDownloads: (items: NewJob[], options: DownloadOptions, outputDir?: string | null) =>
    invoke<Job[]>("add_downloads", { items, options, outputDir: outputDir ?? null }),
  reorder: (ids: string[]) => invoke<void>("reorder_jobs", { ids }),
  diskSpace: (path?: string) => invoke<number | null>("disk_space", { path: path ?? null }),
  setWhenDone: (action: WhenDone) => invoke<void>("set_when_done", { action }),
  getWhenDone: () => invoke<WhenDone>("get_when_done"),
  resetSettings: () => invoke<Settings>("reset_settings"),
  diagnostics: () => invoke<string>("diagnostics"),
  pause: (id: string) => invoke<void>("pause_job", { id }),
  resume: (id: string) => invoke<void>("resume_job", { id }),
  cancel: (id: string) => invoke<void>("cancel_job", { id }),
  pauseAll: () => invoke<void>("pause_all"),
  resumeAll: () => invoke<void>("resume_all"),
  retryFailed: () => invoke<void>("retry_failed"),
  remove: (ids: string[], deleteFiles = false) =>
    invoke<void>("remove_jobs", { ids, deleteFiles }),
  clearFinished: () => invoke<void>("clear_finished"),
  openFile: (id: string) => invoke<void>("open_file", { id }),
  revealFile: (id: string) => invoke<void>("reveal_file", { id }),
  openDownloadDir: () => invoke<void>("open_download_dir"),
};

export const errorText = (e: unknown) =>
  typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
