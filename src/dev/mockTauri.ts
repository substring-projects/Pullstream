/**
 * Browser preview mode (development only).
 *
 * `npm run dev` + opening http://localhost:1420 in a normal browser renders
 * the UI with sample data instead of the Rust backend, so screens can be
 * designed and reviewed without building the app. Loaded from main.tsx only
 * when `import.meta.env.DEV` is true and the page is not inside Tauri, so it
 * is never part of a release build.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Job, MediaInfo, Settings, ToolStatus } from "../lib/types";

const now = Date.now();
const yt = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const base = {
  duration: 612,
  uploader: "Learn Code With Durgesh",
  playlistTitle: null,
  options: { kind: "video", maxHeight: 1080, audioFormat: "mp3" },
  outputDir: "/Users/demo/Downloads/PullStream",
  filenamePrefix: null,
  progress: 0,
  part: 0,
  speed: null,
  eta: null,
  downloadedBytes: null,
  totalBytes: null,
  stage: null,
  filePath: null,
  error: null,
  finishedAt: null,
} as const;

const job = (j: Partial<Job> & Pick<Job, "id" | "title" | "status">, i: number): Job =>
  ({ ...base, url: `https://www.youtube.com/watch?v=${j.id}`, thumbnail: yt("jNQXAC9IVRw"), createdAt: now - 100000 + i, ...j }) as Job;

const PL = "Backend System Design Series";
const jobs: Job[] = [
  job({ id: "a1", title: "Spring Boot Microservices: Complete Course", status: "downloading", progress: 62.4, speed: 6.8e6, eta: 48, downloadedBytes: 412e6, totalBytes: 660e6, stage: "Downloading" }, 1),
  job({ id: "p1", title: "01 - Load Balancing Explained", status: "completed", playlistTitle: PL, progress: 100, totalBytes: 180e6, finishedAt: now - 60000, filePath: "/x/01 - Load Balancing.mp4" }, 2),
  job({ id: "p2", title: "02 - Caching Strategies with Redis", status: "downloading", playlistTitle: PL, progress: 31, speed: 4.1e6, eta: 95, downloadedBytes: 70e6, totalBytes: 220e6 }, 3),
  job({ id: "p3", title: "03 - Database Sharding Deep Dive", status: "processing", playlistTitle: PL, progress: 100, stage: "Merging video & audio" }, 4),
  job({ id: "p4", title: "04 - Message Queues with Kafka", status: "queued", playlistTitle: PL }, 5),
  job({ id: "p5", title: "05 - Rate Limiting Algorithms", status: "queued", playlistTitle: PL }, 6),
  job({ id: "a2", title: "Docker for Beginners – Full Course in Hindi", status: "paused", progress: 18.2 }, 7),
  job({ id: "a3", title: "Kubernetes Crash Course", status: "failed", error: "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser" }, 8),
  job({ id: "a4", title: "Lofi beats to code to", status: "queued", options: { kind: "audio", maxHeight: null, audioFormat: "mp3" } }, 9),
  job({ id: "h1", title: "Java Streams API in One Video", status: "completed", progress: 100, totalBytes: 312e6, finishedAt: now - 3600e3, filePath: "/x/Java Streams API [h1].mp4" }, 10),
  job({ id: "h2", title: "System Design Interview: WhatsApp", status: "completed", progress: 100, totalBytes: 455e6, finishedAt: now - 86400e3 * 2, filePath: "/x/WhatsApp [h2].mp4" }, 11),
  job({ id: "h3", title: "Git & GitHub Masterclass", status: "canceled", finishedAt: now - 86400e3 * 3 }, 12),
];

const settings: Settings = {
  downloadDir: "/Users/demo/Downloads/PullStream",
  maxConcurrent: 3,
  concurrentFragments: 4,
  defaultKind: "video",
  defaultMaxHeight: 1080,
  audioFormat: "mp3",
  embedThumbnail: true,
  embedMetadata: true,
  embedSubtitles: false,
  playlistSubfolder: true,
  clipboardWatch: false,
  notifications: true,
  cookiesBrowser: "none",
  rateLimit: "",
  ytdlpPath: "",
  ffmpegPath: "",
  theme: "system",
  language: "system",
  soundOnComplete: true,
};

const tools: ToolStatus = {
  ytdlp: { path: "/tools/yt-dlp/yt-dlp", version: "2026.10.26", source: "managed" },
  ffmpeg: { path: "/tools/bin/ffmpeg", version: "ffmpeg version 9.1", source: "managed" },
  deno: { path: "/tools/bin/deno", version: "deno 2.9.8 (stable)", source: "managed" },
};

const video: MediaInfo = {
  type: "video",
  url: "https://www.youtube.com/watch?v=demo",
  id: "demo",
  title: "Building a Production-Ready REST API with Spring Boot 3",
  thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
  duration: 5420,
  uploader: "Learn Code With Durgesh",
  viewCount: 284000,
  extractor: "Youtube",
  qualities: [
    { height: 2160, fps: 60, approxSize: 2.1e9, codec: "AV1", hdr: true },
    { height: 1440, fps: 60, approxSize: 1.2e9, codec: "VP9", hdr: false },
    { height: 1080, fps: 30, approxSize: 640e6, codec: "AV1", hdr: false },
    { height: 720, fps: 30, approxSize: 310e6, codec: "H.264", hdr: false },
    { height: 480, fps: 30, approxSize: 150e6, codec: "H.264", hdr: false },
  ],
  audioSize: 82e6,
  hasPlaylist: false,
  subtitles: [
    { lang: "en", name: "English", auto: false },
    { lang: "hi", name: "Hindi", auto: false },
    { lang: "en-orig", name: "English (Original)", auto: true },
  ],
};

mockWindows("main");
mockIPC(
  (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "get_jobs":
        return jobs;
      case "get_settings":
        return settings;
      case "save_settings":
        return a.settings;
      case "tool_status":
        return tools;
      case "get_when_done":
        return "none";
      case "disk_space":
        return 120e9;
      case "fetch_info":
        return video;
      case "diagnostics":
        return "PullStream 0.1.0 (browser preview)";
      case "plugin:app|version":
        return "0.1.0";
      case "plugin:clipboard-manager|read_text":
        return "";
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

console.info("[PullStream] Browser preview mode: using sample data.");

/**
 * Open a specific screen from the URL hash, e.g. #history, #settings:tools,
 * #preview, #select, #lang=hi. Handy for screenshots and design review.
 */
const hash = new URLSearchParams(location.hash.slice(1).replace(/,/g, "&"));
if (location.hash) {
  import("../store").then(({ useStore }) => {
    const apply = () => {
      const s = useStore.getState();
      if (!s.ready) return setTimeout(apply, 50);
      if (hash.has("theme")) s.saveSettings({ theme: hash.get("theme") as Settings["theme"] });
      if (hash.has("lang")) s.saveSettings({ language: hash.get("lang") as Settings["language"] });
      if (hash.has("history")) s.setView("history");
      if (hash.has("about")) s.setView("about");
      if (hash.has("terms")) s.setView("terms");
      for (const [k, v] of hash) if (k.startsWith("settings")) s.openSettings(v || k.split(":")[1] || "general");
      if (hash.has("preview")) s.fetchInfo("https://www.youtube.com/watch?v=demo");
      if (hash.has("select")) s.select(["p4", "p5", "a4"]);
      if (hash.has("setup")) useStore.setState({ tools: { ...tools, deno: { path: null, version: null, source: null } } });
    };
    apply();
  });
}
