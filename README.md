# VidFlow

A fast desktop video downloader built with **Tauri 2 (Rust)** and **React**. It downloads YouTube videos and full playlists, plus links from the 1,000+ other sites yt-dlp supports, and runs several downloads in parallel.

> Unofficial tool. Only download content you own or have permission to download.

## Requirements

To build you need **Node 20+** and **Rust** (`curl https://sh.rustup.rs -sSf | sh`).

## Run

```bash
npm install
npm run tauri dev      # development, with hot reload
npm run tauri build    # release .app + .dmg in src-tauri/target/release/bundle
```

## First-run setup (tools aren't bundled)

The installer is about **5 MB**. If yt-dlp, ffmpeg or deno is missing on first launch, VidFlow shows a setup screen with a single **Download & install** button. It downloads the tools in parallel from their official sources: about 143 MB on macOS and 178 MB on Windows.

| Tool | Source | Installed to (`<data>` = `~/Library/Application Support/com.vidflow.app`) |
|---|---|---|
| yt-dlp | official **unpacked** build (`yt-dlp_macos.zip`, `yt-dlp_win.zip`) | `<data>/tools/yt-dlp/` |
| ffmpeg + ffprobe | martin-riedl.de static builds (macOS/Linux), gyan.dev essentials (Windows) | `<data>/tools/bin/` |
| deno | official release, used by yt-dlp for YouTube's JS challenges | `<data>/tools/bin/` |

- **Verification:** each download is checked against its publisher's SHA-256 checksum, unpacked, and test-run before it is used. A failure leaves the previous install untouched, and a retry only downloads what is still missing.
- **Queued jobs:** they wait until yt-dlp is installed, then start automatically.
- **Existing installs:** if the tools are already installed (for example with Homebrew), setup is skipped.
- **Lookup order:** custom path in Settings → VidFlow's tools → system install.
- **Unpacked yt-dlp:** the single-file build unpacks itself on every run, about 5 s on macOS. The unpacked build starts in about 0.3 s.
- **Settings → Tools:** shows where each tool comes from. It has Install/Reinstall buttons and **Update** for yt-dlp, which uses the same checked download. yt-dlp's own `-U` doesn't support unpacked builds.
- **QA switches (debug builds only):**
  - `VIDFLOW_NO_SYSTEM_TOOLS=1` ignores system installs, to simulate a clean machine.
  - `VIDFLOW_AUTO_SETUP=1` runs setup at launch without the UI.

## Features

- **Video, playlist and link support:** fetches a preview with available qualities and approximate sizes. Playlists show a selectable list that can be filtered and handles thousands of entries.
- **Parallel downloads:** 1–10 at once (Settings). Each video can also fetch up to 16 fragments at a time.
- **Video up to 8K**, or audio as MP3, M4A, Opus, FLAC or WAV, with embedded thumbnail, metadata and subtitles.
- **Queue control:** pause, resume, cancel and retry each job or all of them. Downloads interrupted by quitting resume on the next launch.
- **Convenience:** detects copied links, accepts dragged-in links, and pasting several links queues them all. ⌘L focuses the link field and ⌘↵ downloads immediately with the defaults.
- **System:** light and dark themes, notifications when the window is in the background, a yt-dlp updater, and optional browser cookies for age-restricted videos.

## Architecture

```
React UI (Zustand store, virtualized lists)
   │  invoke(commands)           ▲ events: job-updated / jobs-removed
───┼─────────────────────────────┼───────────────────────────────
Rust core
   commands.rs  → API surface (fetch_info, add_downloads, pause, …)
   manager.rs   → job map + scheduler (concurrency limit) + workers
   ytdlp.rs     → binary discovery, metadata parsing, CLI args
   db.rs        → SQLite (jobs + settings)
   │
   └─ one yt-dlp process per job (own process group) → ffmpeg
```

- **Progress:** each worker runs yt-dlp with a JSON `--progress-template` and reads its stdout and stderr line by line.
- **Update rate:** each job sends at most about 6 updates per second, and the frontend applies them once per animation frame.
- **Pause and cancel:** both stop the job's whole process group, so the ffmpeg processes yt-dlp started stop too. Resuming continues from the `.part` files. Cancelling also deletes them.
- **Finding tools:** the app looks for yt-dlp and ffmpeg in this order:
  1. the custom path set in Settings
  2. the tools installed by first-run setup
  3. the Homebrew and system directories, then `PATH` (macOS GUI apps don't inherit the shell PATH)

## Data

- Database: `~/Library/Application Support/com.vidflow.app/vidflow.db`
- Default download folder: `~/Downloads/VidFlow`

## Roadmap

- Signed and notarized builds, plus app auto-update through the Tauri updater.
- An aria2c downloader for direct file links.
