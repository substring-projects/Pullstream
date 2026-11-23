import { useEffect, useMemo, useState, type ReactNode } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getVersion } from "@tauri-apps/api/app";
import {
  CheckCircle2,
  Cog,
  Download,
  FileAudio,
  FolderOpen,
  Globe,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Stethoscope,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import { useStore } from "../store";
import { LANGUAGES, useT, type Key, type T } from "../i18n";
import { api, errorText } from "../lib/api";
import { qualityLabel } from "../lib/format";
import { checkForUpdates } from "../lib/updates";
import type { MediaKind, Settings, ToolInfo } from "../lib/types";
import { Button, Segmented, Select, Switch } from "./ui";

type TabId = "general" | "downloads" | "formats" | "network" | "tools" | "advanced";

const TABS: { id: TabId; label: Key; icon: typeof Cog }[] = [
  { id: "general", label: "settings.tab.general", icon: Cog },
  { id: "downloads", label: "settings.tab.downloads", icon: Download },
  { id: "formats", label: "settings.tab.formats", icon: FileAudio },
  { id: "network", label: "settings.tab.network", icon: Globe },
  { id: "tools", label: "settings.tab.tools", icon: Wrench },
  { id: "advanced", label: "settings.tab.advanced", icon: Stethoscope },
];

interface RowDef {
  tab: TabId;
  label: Key;
  hint?: Key;
  /** Dynamic hint text (e.g. the folder path), searched as well. */
  hintText?: string;
  control: ReactNode;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 min-h-14">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-0.5 break-words selectable">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Slider({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 accent-[var(--accent)]"
      />
      <span className="w-6 text-right tabular-nums font-semibold">{value}</span>
    </div>
  );
}

export function SettingsView() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const save = useStore((s) => s.saveSettings);
  const setSettings = useStore((s) => s.setSettings);
  const toast = useStore((s) => s.toast);
  const tools = useStore((s) => s.tools);
  const setTools = useStore((s) => s.setTools);
  const tab = useStore((s) => s.settingsTab) as TabId;
  const [query, setQuery] = useState("");
  const [updating, setUpdating] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [version, setVersion] = useState("");

  const refreshTools = () => api.toolStatus().then(setTools).catch(() => {});
  useEffect(() => {
    refreshTools();
    getVersion().then(setVersion).catch(() => {});
  }, [settings?.ytdlpPath, settings?.ffmpegPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<RowDef[]>(() => {
    if (!settings) return [];
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => save({ [k]: v } as Partial<Settings>);

    const installTool = async (id: string) => {
      setInstalling(id);
      try {
        setTools(await api.installTools([id]));
        toast({ kind: "success", text: t("settings.installed", { tool: id }) });
      } catch (e) {
        toast({ kind: "error", text: errorText(e) });
        refreshTools();
      } finally {
        setInstalling(null);
      }
    };
    const updateYtdlp = async () => {
      setUpdating(true);
      try {
        const out = await api.updateYtdlp();
        toast({ kind: "success", text: out.split("\n").slice(-2).join(" ") });
        refreshTools();
      } catch (e) {
        toast({ kind: "error", text: errorText(e) });
      } finally {
        setUpdating(false);
      }
    };
    const installBtn = (id: string, present: boolean) => (
      <Button size="sm" onClick={() => installTool(id)} disabled={!!installing || updating}>
        {installing === id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        {present ? t("settings.reinstall") : t("settings.install")}
      </Button>
    );

    return [
      // General
      {
        tab: "general",
        label: "settings.theme",
        control: (
          <Segmented<Settings["theme"]>
            layoutId="settings-theme"
            value={settings.theme}
            onChange={(v) => set("theme", v)}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "light", label: t("settings.theme.light") },
              { value: "dark", label: t("settings.theme.dark") },
            ]}
          />
        ),
      },
      {
        tab: "general",
        label: "settings.language",
        control: (
          <Select<Settings["language"]>
            value={settings.language}
            onChange={(v) => set("language", v)}
            aria-label={t("settings.language")}
            options={[{ value: "system", label: t("settings.language.system") }, ...LANGUAGES]}
          />
        ),
      },
      { tab: "general", label: "settings.notifications", hint: "settings.notificationsHint", control: <Switch checked={settings.notifications} onChange={(v) => set("notifications", v)} label={t("settings.notifications")} /> },
      { tab: "general", label: "settings.sound", control: <Switch checked={settings.soundOnComplete} onChange={(v) => set("soundOnComplete", v)} label={t("settings.sound")} /> },
      { tab: "general", label: "settings.clipboard", hint: "settings.clipboardHint", control: <Switch checked={settings.clipboardWatch} onChange={(v) => set("clipboardWatch", v)} label={t("settings.clipboard")} /> },

      // Downloads
      {
        tab: "downloads",
        label: "settings.saveTo",
        hintText: settings.downloadDir,
        control: (
          <>
            <Button size="sm" onClick={() => api.openDownloadDir()}>{t("settings.open")}</Button>
            <Button
              size="sm"
              onClick={async () => {
                const dir = await open({ directory: true, defaultPath: settings.downloadDir });
                if (typeof dir === "string") set("downloadDir", dir);
              }}
            >
              <FolderOpen className="size-3.5" /> {t("settings.change")}
            </Button>
          </>
        ),
      },
      { tab: "downloads", label: "settings.parallel", hint: "settings.parallelHint", control: <Slider value={settings.maxConcurrent} min={1} max={10} onChange={(v) => set("maxConcurrent", v)} label={t("settings.parallel")} /> },
      { tab: "downloads", label: "settings.connections", hint: "settings.connectionsHint", control: <Slider value={settings.concurrentFragments} min={1} max={16} onChange={(v) => set("concurrentFragments", v)} label={t("settings.connections")} /> },
      { tab: "downloads", label: "settings.subfolders", hint: "settings.subfoldersHint", control: <Switch checked={settings.playlistSubfolder} onChange={(v) => set("playlistSubfolder", v)} label={t("settings.subfolders")} /> },

      // Formats
      {
        tab: "formats",
        label: "settings.defaultType",
        hint: "settings.defaultTypeHint",
        control: (
          <Segmented<MediaKind>
            layoutId="settings-kind"
            value={settings.defaultKind}
            onChange={(v) => set("defaultKind", v)}
            options={[
              { value: "video", label: t("preview.video") },
              { value: "audio", label: t("preview.audio") },
            ]}
          />
        ),
      },
      {
        tab: "formats",
        label: "settings.defaultQuality",
        control: (
          <Select
            value={String(settings.defaultMaxHeight ?? "best")}
            onChange={(v) => set("defaultMaxHeight", v === "best" ? null : Number(v))}
            aria-label={t("settings.defaultQuality")}
            options={[null, 2160, 1440, 1080, 720, 480, 360].map((h) => ({
              value: String(h ?? "best"),
              label: h ? qualityLabel(h) : t("preview.bestAvailable"),
            }))}
          />
        ),
      },
      {
        tab: "formats",
        label: "settings.defaultAudio",
        control: (
          <Select
            value={settings.audioFormat}
            onChange={(v) => set("audioFormat", v)}
            aria-label={t("settings.defaultAudio")}
            options={["mp3", "m4a", "opus", "flac", "wav"].map((f) => ({ value: f, label: f.toUpperCase() }))}
          />
        ),
      },
      { tab: "formats", label: "settings.embedThumb", control: <Switch checked={settings.embedThumbnail} onChange={(v) => set("embedThumbnail", v)} label={t("settings.embedThumb")} /> },
      { tab: "formats", label: "settings.embedMeta", hint: "settings.embedMetaHint", control: <Switch checked={settings.embedMetadata} onChange={(v) => set("embedMetadata", v)} label={t("settings.embedMeta")} /> },
      { tab: "formats", label: "settings.embedSubs", hint: "settings.embedSubsHint", control: <Switch checked={settings.embedSubtitles} onChange={(v) => set("embedSubtitles", v)} label={t("settings.embedSubs")} /> },

      // Network
      {
        tab: "network",
        label: "settings.speedLimit",
        hint: "settings.speedLimitHint",
        control: (
          <input
            value={settings.rateLimit}
            onChange={(e) => set("rateLimit", e.target.value)}
            placeholder={t("settings.unlimited")}
            aria-label={t("settings.speedLimit")}
            className="h-9 w-32 px-3 rounded-lg bg-panel-2 border border-line outline-none focus:border-accent text-[13px]"
          />
        ),
      },
      {
        tab: "network",
        label: "settings.cookies",
        hint: "settings.cookiesHint",
        control: (
          <Select
            value={settings.cookiesBrowser}
            onChange={(v) => set("cookiesBrowser", v)}
            aria-label={t("settings.cookies")}
            options={[
              { value: "none", label: t("settings.off") },
              { value: "chrome", label: "Chrome" },
              { value: "safari", label: "Safari" },
              { value: "firefox", label: "Firefox" },
              { value: "edge", label: "Edge" },
              { value: "brave", label: "Brave" },
            ]}
          />
        ),
      },

      // Tools
      {
        tab: "tools",
        label: "settings.tool.ytdlp" as Key,
        control: (
          <ToolStatusRow name="yt-dlp" info={tools?.ytdlp} t={t}>
            {tools?.ytdlp.path ? (
              <Button size="sm" onClick={updateYtdlp} disabled={updating || !!installing}>
                {updating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {t("settings.update")}
              </Button>
            ) : (
              installBtn("yt-dlp", false)
            )}
          </ToolStatusRow>
        ),
      },
      {
        tab: "tools",
        label: "settings.tool.ffmpeg" as Key,
        control: (
          <ToolStatusRow name="ffmpeg" info={tools?.ffmpeg} t={t}>
            {tools?.ffmpeg.source !== "custom" && installBtn("ffmpeg", !!tools?.ffmpeg.path)}
          </ToolStatusRow>
        ),
      },
      {
        tab: "tools",
        label: "settings.tool.deno" as Key,
        control: (
          <ToolStatusRow name="deno" info={tools?.deno} t={t}>
            {installBtn("deno", !!tools?.deno.path)}
          </ToolStatusRow>
        ),
      },
      { tab: "tools", label: "settings.customYtdlp", hint: "settings.customHint", control: <PathInput value={settings.ytdlpPath} onChange={(v) => set("ytdlpPath", v)} t={t} /> },
      { tab: "tools", label: "settings.customFfmpeg", hint: "settings.customHint", control: <PathInput value={settings.ffmpegPath} onChange={(v) => set("ffmpegPath", v)} t={t} /> },

      // Advanced
      {
        tab: "advanced",
        label: "settings.version",
        hintText: version,
        control: (
          <Button size="sm" onClick={() => checkForUpdates(true)}>
            <RefreshCw className="size-3.5" /> {t("update.check")}
          </Button>
        ),
      },
      {
        tab: "advanced",
        label: "settings.diagnostics",
        hint: "settings.diagnosticsHint",
        control: (
          <Button
            size="sm"
            onClick={async () => {
              try {
                await writeText(await api.diagnostics());
                toast({ kind: "success", text: t("settings.diagnosticsCopied") });
              } catch (e) {
                toast({ kind: "error", text: errorText(e) });
              }
            }}
          >
            <Stethoscope className="size-3.5" /> {t("settings.copyDiagnostics")}
          </Button>
        ),
      },
      {
        tab: "advanced",
        label: "settings.reset",
        hint: "settings.resetConfirm",
        control: (
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              const ok = await ask(t("settings.resetConfirm"), {
                title: t("settings.reset"),
                kind: "warning",
                okLabel: t("common.reset"),
                cancelLabel: t("common.cancel"),
              });
              if (!ok) return;
              setSettings(await api.resetSettings());
              toast({ kind: "success", text: t("settings.resetDone") });
            }}
          >
            <RotateCcw className="size-3.5" /> {t("common.reset")}
          </Button>
        ),
      },
    ];
  }, [settings, tools, installing, updating, version, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings) return null;

  const q = query.trim().toLowerCase();
  const matches = (r: RowDef) =>
    [t(r.label), r.hint ? t(r.hint) : "", r.hintText ?? "", t(TABS.find((x) => x.id === r.tab)!.label)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  const shown = q ? rows.filter(matches) : rows.filter((r) => r.tab === tab);
  const groups = q
    ? TABS.map((tb) => ({ tab: tb, rows: shown.filter((r) => r.tab === tb.id) })).filter((g) => g.rows.length)
    : [{ tab: TABS.find((x) => x.id === tab)!, rows: shown }];

  return (
    <div className="flex-1 min-h-0 flex gap-6">
      {/* Tabs */}
      <nav className="w-48 shrink-0" aria-label={t("settings.title")}>
        <h1 className="text-2xl font-bold mb-4 px-1">{t("settings.title")}</h1>
        <div className="flex items-center gap-2 h-9 px-3 mb-3 rounded-lg bg-panel border border-line focus-within:border-accent">
          <Search className="size-3.5 text-muted shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
            className="bg-transparent outline-none text-[13px] flex-1 min-w-0"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label={t("url.clear")} className="text-muted hover:text-fg cursor-default">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="space-y-0.5" role="tablist" aria-orientation="vertical">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={!q && tab === tb.id}
              onClick={() => {
                setQuery("");
                useStore.setState({ settingsTab: tb.id });
              }}
              className={clsx(
                "w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors cursor-default",
                !q && tab === tb.id ? "bg-panel-2 text-fg border border-line" : "text-muted hover:text-fg hover:bg-hover",
              )}
            >
              <tb.icon className={clsx("size-4", !q && tab === tb.id && "text-accent")} />
              {t(tb.label)}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto -mr-2 pr-2 pb-8" role="tabpanel">
        <div className="max-w-2xl pt-12">
          {groups.length === 0 && <div className="text-muted text-[13px] px-1">{t("settings.noMatch", { q: query })}</div>}
          {groups.map((g) => (
            <section key={g.tab.id} className="mb-6">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted mb-2 px-1">{t(g.tab.label)}</h3>
              <div className="rounded-2xl bg-panel border border-line divide-y divide-line shadow-[var(--shadow)]">
                {g.rows.map((r) =>
                  r.label.startsWith("settings.tool.") ? (
                    <div key={r.label} className="px-4 py-3.5">{r.control}</div>
                  ) : (
                    <Row key={r.label} label={t(r.label)} hint={r.hintText ?? (r.hint ? t(r.hint) : undefined)}>
                      {r.control}
                    </Row>
                  ),
                )}
              </div>
            </section>
          ))}
          {!q && tab === "advanced" && <p className="text-[12px] text-muted px-1">{t("settings.disclaimer")}</p>}
        </div>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, Key> = {
  managed: "settings.source.managed",
  system: "settings.source.system",
  custom: "settings.source.custom",
};

/** Tool name, role, version and source, filling the whole row. */
function ToolStatusRow({ name, info, t, children }: { name: string; info?: ToolInfo; t: T; children?: ReactNode }) {
  const ok = !!info?.path;
  const role = t(`settings.tool.${name === "yt-dlp" ? "ytdlp" : name}` as Key);
  const version = info?.version?.replace(/^(ffmpeg|deno) version /, "").replace(/^deno /, "").split(" ")[0];
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium">{name}</div>
        <div className="text-[12px] text-muted mt-0.5">
          {role} · {info ? (ok ? version ?? t("settings.tool.unknown") : t("settings.tool.missing")) : "…"}
        </div>
      </div>
      {info?.source && (
        <span title={info.path ?? ""} className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-panel-2 border border-line text-muted">
          {t(SOURCE_LABEL[info.source])}
        </span>
      )}
      {info && (ok ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-danger" />)}
      {children}
    </div>
  );
}

function PathInput({ value, onChange, t }: { value: string; onChange: (v: string) => void; t: T }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div className="flex gap-2">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onChange(v.trim())}
        placeholder={t("settings.auto")}
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
        {t("settings.browse")}
      </Button>
    </div>
  );
}
