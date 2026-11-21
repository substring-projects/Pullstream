import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { motion } from "motion/react";
import { AlertCircle, CheckCircle2, Cpu, Download, Film, Loader2, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { missingTools, useStore } from "../store";
import { api, errorText } from "../lib/api";
import { formatBytes } from "../lib/format";
import type { SetupProgress, ToolId, ToolInfo } from "../lib/types";
import { Button } from "./ui";
import logoMark from "../assets/logo-mark.png";

const isWindows = navigator.userAgent.includes("Windows");

/** Approximate download sizes (MB) per platform. */
const SIZE: Record<ToolId, number> = isWindows
  ? { "yt-dlp": 23, ffmpeg: 114, deno: 41 }
  : { "yt-dlp": 52, ffmpeg: 54, deno: 37 };

const TOOLS: { id: ToolId; key: "ytdlp" | "ffmpeg" | "deno"; name: string; role: string; icon: typeof Film }[] = [
  { id: "yt-dlp", key: "ytdlp", name: "yt-dlp", role: "Reads videos and playlists from YouTube and 1,000+ sites", icon: Download },
  { id: "ffmpeg", key: "ffmpeg", name: "FFmpeg", role: "Merges HD video with audio and converts to MP3", icon: Film },
  { id: "deno", key: "deno", name: "Deno", role: "Solves YouTube's playback checks", icon: Cpu },
];

type RowState = { status: "found" | "pending" | SetupProgress["status"]; downloaded: number; total: number | null; message: string | null };

export function SetupScreen() {
  const { tools, setTools, skipSetup, toast } = useStore();
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Record<ToolId, RowState>>(() => initialRows(tools));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const un = listen<SetupProgress>("setup-progress", (e) => {
      const p = e.payload;
      setRows((r) => ({ ...r, [p.tool]: { status: p.status, downloaded: p.downloaded, total: p.total, message: p.message } }));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const missing = missingTools(tools);
  const needed = TOOLS.filter((t) => missing.includes(t.key));
  const totalMb = needed.reduce((a, t) => a + SIZE[t.id], 0);

  const install = async () => {
    setRunning(true);
    setError(null);
    setRows((r) => {
      const next = { ...r };
      for (const t of needed) next[t.id] = { status: "pending", downloaded: 0, total: null, message: null };
      return next;
    });
    try {
      const status = await api.installTools();
      // Brief pause so the user sees everything turn green.
      setTimeout(() => {
        setTools(status);
        toast({ kind: "success", text: "All set! Paste a link to start downloading." });
      }, 900);
    } catch (e) {
      setError(errorText(e));
      // Keep what did install; a retry only fetches what's still missing.
      useStore.getState().refreshTools().then((t) => setRows((r) => mergeFound(r, t)));
      setRunning(false);
    }
  };

  const overall = needed.length
    ? needed.reduce((a, t) => {
        const r = rows[t.id];
        if (r.status === "done" || r.status === "installing") return a + 1;
        if (r.status === "downloading" && r.total) return a + Math.min(r.downloaded / r.total, 1) * 0.95;
        return a;
      }, 0) / needed.length
    : 1;

  return (
    <div className="h-full grid place-items-center px-6 relative overflow-hidden">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-10" />
      {/* soft background glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[640px] rounded-full gradient-accent opacity-[0.12] blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative w-full max-w-[560px]"
      >
        <div className="flex flex-col items-center text-center">
          <img
            src={logoMark}
            alt="PullStream"
            draggable={false}
            className="size-20 rounded-[22px] shadow-[0_10px_40px_-8px_var(--accent)]"
          />
          <h1 className="mt-5 text-[26px] font-bold tracking-tight">
            Welcome to Pull<span className="text-gradient">Stream</span>
          </h1>
          <p className="mt-2 text-[14px] text-muted max-w-[440px]">
            One quick setup step: PullStream uses three free, open-source tools to download and process videos. We'll
            fetch them from their official sources. This only happens once.
          </p>
        </div>

        <div className="mt-7 rounded-2xl bg-panel border border-line shadow-[var(--shadow)] divide-y divide-line overflow-hidden">
          {TOOLS.map((t) => (
            <ToolLine key={t.id} tool={t} row={rows[t.id]} info={tools?.[t.key]} />
          ))}
        </div>

        {running && (
          <div className="mt-5">
            <div className="h-2 rounded-full bg-panel-2 overflow-hidden">
              <motion.div
                className="h-full gradient-accent rounded-full"
                animate={{ width: `${Math.round(overall * 100)}%` }}
                transition={{ ease: "easeOut", duration: 0.3 }}
              />
            </div>
            <div className="mt-2 text-center text-[12px] text-muted tabular-nums">{Math.round(overall * 100)}%</div>
          </div>
        )}

        {error && (
          <div className="mt-5 flex items-start gap-2.5 p-3 rounded-xl bg-danger/10 text-danger text-[13px]">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span className="selectable">{error}</span>
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button variant="primary" size="lg" className="w-full max-w-[320px]" onClick={install} disabled={running}>
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Installing…
              </>
            ) : (
              <>
                <Download className="size-4" /> {error ? "Retry" : "Download & install"} · ~{totalMb} MB
              </>
            )}
          </Button>
          <div className="flex items-center gap-1.5 text-[12px] text-muted">
            <ShieldCheck className="size-3.5 text-success" /> Every file is checked against its official SHA-256
            checksum
          </div>
          {!running && (
            <button onClick={skipSetup} className="text-[12px] text-muted hover:text-fg underline-offset-2 hover:underline cursor-default">
              Skip for now. I'll set custom paths in Settings
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ToolLine({
  tool,
  row,
  info,
}: {
  tool: (typeof TOOLS)[number];
  row: RowState;
  info?: ToolInfo;
}) {
  const Icon = tool.icon;
  let right: React.ReactNode;
  switch (row.status) {
    case "found":
      right = (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-success font-medium">
          <CheckCircle2 className="size-4" /> {info?.source === "managed" ? "Installed" : "Found on this computer"}
        </span>
      );
      break;
    case "pending":
      right = <span className="text-[12px] text-muted">~{SIZE[tool.id]} MB</span>;
      break;
    case "downloading":
      right = (
        <div className="w-36 text-right">
          <div className="text-[11px] text-muted tabular-nums">
            {formatBytes(row.downloaded)}
            {row.total ? ` / ${formatBytes(row.total)}` : ""}
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-panel-2 overflow-hidden">
            <div
              className="h-full gradient-accent rounded-full transition-[width] duration-200"
              style={{ width: row.total ? `${Math.min(100, (row.downloaded / row.total) * 100)}%` : "30%" }}
            />
          </div>
        </div>
      );
      break;
    case "installing":
      right = (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          <Loader2 className="size-3.5 animate-spin" /> Verifying & installing
        </span>
      );
      break;
    case "done":
      right = (
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center gap-1.5 text-[12px] text-success font-medium"
        >
          <CheckCircle2 className="size-4" /> Installed
        </motion.span>
      );
      break;
    case "error":
      right = (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-danger font-medium max-w-48 truncate" title={row.message ?? ""}>
          <AlertCircle className="size-4 shrink-0" /> {row.message ?? "Failed"}
        </span>
      );
      break;
  }
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <div
        className={clsx(
          "size-9 rounded-xl grid place-items-center shrink-0",
          row.status === "found" || row.status === "done" ? "bg-success/10 text-success" : "bg-accent-soft text-accent",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold">{tool.name}</div>
        <div className="text-[12px] text-muted truncate">{tool.role}</div>
      </div>
      {right}
    </div>
  );
}

function initialRows(tools: ReturnType<typeof useStore.getState>["tools"]): Record<ToolId, RowState> {
  const blank = { status: "pending" as const, downloaded: 0, total: null, message: null };
  return mergeFound({ "yt-dlp": { ...blank }, ffmpeg: { ...blank }, deno: { ...blank } }, tools);
}

function mergeFound(rows: Record<ToolId, RowState>, tools: ReturnType<typeof useStore.getState>["tools"]) {
  const next = { ...rows };
  for (const t of TOOLS) {
    if (tools?.[t.key].path) next[t.id] = { status: "found", downloaded: 0, total: null, message: null };
  }
  return next;
}
