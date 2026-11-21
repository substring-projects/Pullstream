import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, Download, FolderOpen, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useStore } from "../store";
import { api, errorText } from "../lib/api";
import { qualityLabel } from "../lib/format";
import type { MediaKind, Settings, ToolInfo } from "../lib/types";
import { Button, Segmented, Select, Switch } from "./ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted mb-2 px-1">{title}</h3>
      <div className="rounded-2xl bg-panel border border-line divide-y divide-line shadow-[var(--shadow)]">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 min-h-14">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 accent-[var(--accent)]"
      />
      <span className="w-6 text-right tabular-nums font-semibold">{value}</span>
    </div>
  );
}

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const tools = useStore((s) => s.tools);
  const setTools = useStore((s) => s.setTools);
  const [updating, setUpdating] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const refreshTools = () => api.toolStatus().then(setTools).catch(() => {});
  const installTool = async (id: string) => {
    setInstalling(id);
    try {
      setTools(await api.installTools([id]));
      toast({ kind: "success", text: `${id} installed` });
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
      refreshTools();
    } finally {
      setInstalling(null);
    }
  };
  const installBtn = (id: string, present: boolean) => (
    <Button size="sm" onClick={() => installTool(id)} disabled={!!installing || updating}>
      {installing === id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {present ? "Reinstall" : "Install"}
    </Button>
  );
  useEffect(() => {
    refreshTools();
  }, [settings?.ytdlpPath, settings?.ffmpegPath]);

  if (!settings) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => save({ [k]: v } as Partial<Settings>);

  const pickFolder = async () => {
    const dir = await open({ directory: true, defaultPath: settings.downloadDir });
    if (typeof dir === "string") set("downloadDir", dir);
  };

  const update = async () => {
    setUpdating(true);
    try {
      const out = await api.updateYtdlp();
      toast({ kind: "success", text: out.split("\n").slice(-2).join(" ") || "yt-dlp updated" });
      refreshTools();
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto -mx-2 px-2">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>

        <Section title="Downloads">
          <Row label="Save to" hint={settings.downloadDir}>
            <Button size="sm" onClick={() => api.openDownloadDir()}>Open</Button>
            <Button size="sm" onClick={pickFolder}>
              <FolderOpen className="size-3.5" /> Change
            </Button>
          </Row>
          <Row label="Parallel downloads" hint="How many videos download at the same time">
            <Slider value={settings.maxConcurrent} min={1} max={10} onChange={(v) => set("maxConcurrent", v)} />
          </Row>
          <Row label="Connections per video" hint="Fragments fetched concurrently for each download (faster on HLS/DASH)">
            <Slider value={settings.concurrentFragments} min={1} max={16} onChange={(v) => set("concurrentFragments", v)} />
          </Row>
          <Row label="Speed limit" hint="Per download, e.g. 5M or 800K. Empty = unlimited">
            <input
              value={settings.rateLimit}
              onChange={(e) => set("rateLimit", e.target.value)}
              placeholder="Unlimited"
              className="h-9 w-32 px-3 rounded-lg bg-panel-2 border border-line outline-none focus:border-accent text-[13px]"
            />
          </Row>
          <Row label="Playlist subfolders" hint="Save each playlist into its own folder">
            <Switch checked={settings.playlistSubfolder} onChange={(v) => set("playlistSubfolder", v)} />
          </Row>
        </Section>

        <Section title="Defaults">
          <Row label="Default type" hint="Used by Quick download and as the starting choice">
            <Segmented<MediaKind>
              layoutId="settings-kind"
              value={settings.defaultKind}
              onChange={(v) => set("defaultKind", v)}
              options={[
                { value: "video", label: "Video" },
                { value: "audio", label: "Audio" },
              ]}
            />
          </Row>
          <Row label="Default video quality">
            <Select
              value={String(settings.defaultMaxHeight ?? "best")}
              onChange={(v) => set("defaultMaxHeight", v === "best" ? null : Number(v))}
              options={[null, 2160, 1440, 1080, 720, 480, 360].map((h) => ({
                value: String(h ?? "best"),
                label: h ? qualityLabel(h) : "Best available",
              }))}
            />
          </Row>
          <Row label="Default audio format">
            <Select
              value={settings.audioFormat}
              onChange={(v) => set("audioFormat", v)}
              options={["mp3", "m4a", "opus", "flac", "wav"].map((f) => ({ value: f, label: f.toUpperCase() }))}
            />
          </Row>
          <Row label="Embed thumbnail">
            <Switch checked={settings.embedThumbnail} onChange={(v) => set("embedThumbnail", v)} />
          </Row>
          <Row label="Embed metadata" hint="Title, artist, date and description">
            <Switch checked={settings.embedMetadata} onChange={(v) => set("embedMetadata", v)} />
          </Row>
          <Row label="Embed English subtitles" hint="When available">
            <Switch checked={settings.embedSubtitles} onChange={(v) => set("embedSubtitles", v)} />
          </Row>
        </Section>

        <Section title="App">
          <Row label="Theme">
            <Segmented<Settings["theme"]>
              layoutId="settings-theme"
              value={settings.theme}
              onChange={(v) => set("theme", v)}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </Row>
          <Row label="Detect copied links" hint="Offer to fetch a link from the clipboard when you switch to the app">
            <Switch checked={settings.clipboardWatch} onChange={(v) => set("clipboardWatch", v)} />
          </Row>
          <Row label="Notifications" hint="Notify when downloads finish in the background">
            <Switch checked={settings.notifications} onChange={(v) => set("notifications", v)} />
          </Row>
          <Row label="Use browser cookies" hint="Helps with age-restricted or members-only videos and bot checks">
            <Select
              value={settings.cookiesBrowser}
              onChange={(v) => set("cookiesBrowser", v)}
              options={[
                { value: "none", label: "Off" },
                { value: "chrome", label: "Chrome" },
                { value: "safari", label: "Safari" },
                { value: "firefox", label: "Firefox" },
                { value: "edge", label: "Edge" },
                { value: "brave", label: "Brave" },
              ]}
            />
          </Row>
        </Section>

        <Section title="Tools">
          <ToolRow
            label="yt-dlp"
            role="Video extraction"
            info={tools?.ytdlp}
            action={
              tools?.ytdlp.path ? (
                <Button size="sm" onClick={update} disabled={updating || !!installing}>
                  {updating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  Update
                </Button>
              ) : (
                installBtn("yt-dlp", false)
              )
            }
          />
          <ToolRow
            label="ffmpeg"
            role="Merging HD video and converting audio"
            info={tools?.ffmpeg}
            action={tools?.ffmpeg.source === "custom" ? undefined : installBtn("ffmpeg", !!tools?.ffmpeg.path)}
          />
          <ToolRow
            label="deno"
            role="Solves YouTube's JavaScript challenges"
            info={tools?.deno}
            action={installBtn("deno", !!tools?.deno.path)}
          />
          <Row label="Custom yt-dlp path" hint="Optional. Leave empty to use VidFlow's copy">
            <PathInput value={settings.ytdlpPath} onChange={(v) => set("ytdlpPath", v)} />
          </Row>
          <Row label="Custom ffmpeg path" hint="Optional. Leave empty to use VidFlow's copy">
            <PathInput value={settings.ffmpegPath} onChange={(v) => set("ffmpegPath", v)} />
          </Row>
        </Section>

        <p className="text-[12px] text-muted px-1 pb-8">
          VidFlow is an unofficial tool. Only download content you own or have permission to download, and respect the
          terms of the sites you use.
        </p>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  managed: "Installed by VidFlow",
  system: "System install",
  custom: "Custom path",
};

function ToolRow({ label, role, info, action }: { label: string; role: string; info?: ToolInfo; action?: ReactNode }) {
  const ok = !!info?.path;
  const version = info?.version?.replace(/^(ffmpeg|deno) version /, "").replace(/^deno /, "").split(" ")[0];
  return (
    <Row
      label={label}
      hint={info ? (ok ? `${role} · ${version ?? "unknown version"}` : `${role} · missing`) : role}
    >
      {info?.source && (
        <span
          title={info.path ?? ""}
          className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-panel-2 border border-line text-muted"
        >
          {SOURCE_LABEL[info.source]}
        </span>
      )}
      {info && (ok ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-danger" />)}
      {action}
    </Row>
  );
}

function PathInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex gap-2">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onChange(v.trim())}
        placeholder="Auto"
        spellCheck={false}
        className="h-9 w-56 px-3 rounded-lg bg-panel-2 border border-line outline-none focus:border-accent text-[13px]"
      />
      <Button
        size="sm"
        onClick={async () => {
          const f = await open({ directory: false });
          if (typeof f === "string") onChange(f);
        }}
      >
        Browse
      </Button>
    </div>
  );
}
