import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Gauge,
  HardDrive,
  HelpCircle,
  History,
  Info,
  Moon,
  Power,
  Settings as SettingsIcon,
  WifiOff,
  X,
} from "lucide-react";
import clsx from "clsx";
import { missingTools, useStore, type View } from "./store";
import { useT, tNow, type Key } from "./i18n";
import { api, errorText, type WhenDone } from "./lib/api";
import { extractUrls, formatBytes, formatSpeed } from "./lib/format";
import { isActive } from "./lib/types";
import { isMac, isTyping, modKey } from "./lib/platform";
import { playChime } from "./lib/sound";
import { checkForUpdates, showWhatsNewIfUpdated } from "./lib/updates";
import { HELP_URL, open } from "./lib/links";
import { UrlBar, useSubmitUrls } from "./components/UrlBar";
import { PreviewPanel } from "./components/Preview";
import { Queue } from "./components/Queue";
import { SettingsView } from "./components/SettingsView";
import { SetupScreen } from "./components/SetupScreen";
import { AboutView } from "./components/AboutView";
import { TermsView } from "./components/TermsView";
import { UpdateDialogs } from "./components/Dialogs";
import { Button } from "./components/ui";
import logoMark from "./assets/logo-mark.png";

/** macOS: overlay title bar + translucent sidebar (see tauri.macos.conf.json). */
if (isMac && "__TAURI_INTERNALS__" in window) document.documentElement.classList.add("vibrant");

export default function App() {
  const { init, ready, view, settings, tools, setupSkipped } = useStore();

  useEffect(() => {
    init()
      .then(() => {
        showWhatsNewIfUpdated().catch(() => {});
        // Quiet update check a few seconds after launch.
        setTimeout(() => checkForUpdates(false), 4000);
      })
      .catch((e) => console.error(e));
  }, [init]);

  useTheme(settings?.theme ?? "system");
  useClipboardWatch(!!settings?.clipboardWatch);
  useMenuAndShortcuts();
  useTaskbarProgress();
  useCompletionSound(!!settings?.soundOnComplete);
  useOnlineStatus();
  useEffect(() => {
    document.documentElement.lang = settings?.language === "hi" ? "hi" : "en";
  }, [settings?.language]);

  const needsSetup = ready && missingTools(tools).length > 0 && !setupSkipped;

  return (
    <MotionConfig reducedMotion="user">
      {needsSetup ? (
        <div className="h-full bg-bg">
          <SetupScreen />
        </div>
      ) : (
        <div className="h-full flex">
          <Sidebar />
          <main className="flex-1 min-w-0 flex flex-col bg-bg">
            {/* Draggable title-bar area (macOS overlay title bar) */}
            <div data-tauri-drag-region className={isMac ? "h-10 shrink-0" : "h-5 shrink-0"} />
            <div className="flex-1 min-h-0 flex flex-col px-7 pb-6">
              {!ready ? null : view === "downloads" ? (
                <>
                  <Banners />
                  <UrlBar />
                  <div className="mt-4">
                    <PreviewPanel />
                  </div>
                  <div className="mt-5 flex-1 min-h-0 flex flex-col">
                    <Queue mode="downloads" />
                  </div>
                </>
              ) : view === "history" ? (
                <Queue mode="history" />
              ) : view === "settings" ? (
                <SettingsView />
              ) : view === "about" ? (
                <AboutView />
              ) : (
                <TermsView />
              )}
            </div>
          </main>
        </div>
      )}
      <Toasts />
      <UpdateDialogs />
    </MotionConfig>
  );
}

// ------------------------------------------------------------------ sidebar

function Sidebar() {
  const t = useT();
  const { view, setView, jobs } = useStore();
  const stats = useMemo(() => {
    let active = 0,
      queued = 0,
      speed = 0,
      failed = 0;
    for (const j of Object.values(jobs)) {
      if (isActive(j.status)) {
        active++;
        speed += j.speed ?? 0;
      } else if (j.status === "queued") queued++;
      else if (j.status === "failed") failed++;
    }
    return { active, queued, speed, failed };
  }, [jobs]);

  type Item = {
    id: View | "help";
    label: Key;
    icon: typeof Download;
    badge?: number;
    badgeTone?: "accent" | "danger";
    href?: string;
    shortcut?: string;
  };
  const main: Item[] = [
    {
      id: "downloads",
      label: "nav.downloads",
      icon: Download,
      badge: stats.active + stats.queued || stats.failed || undefined,
      badgeTone: stats.active + stats.queued ? "accent" : "danger",
      shortcut: "1",
    },
    { id: "history", label: "nav.history", icon: History, shortcut: "2" },
    { id: "settings", label: "nav.settings", icon: SettingsIcon, shortcut: "," },
  ];
  const secondary: Item[] = [
    { id: "about", label: "nav.about", icon: Info },
    { id: "terms", label: "nav.terms", icon: FileText },
    { id: "help", label: "nav.help", icon: HelpCircle, href: HELP_URL },
  ];

  const renderItem = (it: Item) => (
    <button
      key={it.id}
      onClick={() => (it.href ? open(it.href) : setView(it.id as View))}
      aria-current={view === it.id ? "page" : undefined}
      title={it.href ? it.href : it.shortcut ? `${isMac ? "⌘" : "Ctrl+"}${it.shortcut}` : undefined}
      className={clsx(
        "relative w-full flex items-center gap-3 h-9 px-3 rounded-lg text-[13.5px] font-medium transition-colors cursor-default",
        view === it.id ? "text-fg" : "text-muted hover:text-fg hover:bg-hover/70",
      )}
    >
      {view === it.id && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-panel-2/90 border border-line"
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
      <it.icon className={clsx("size-4 relative", view === it.id && "text-accent")} />
      <span className="relative flex-1 text-left truncate">{t(it.label)}</span>
      {it.href && <ArrowUpRight className="relative size-3.5 opacity-60" />}
      {it.badge ? (
        <span
          className={clsx(
            "relative min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-semibold grid place-items-center",
            it.badgeTone === "danger" ? "bg-danger" : "gradient-accent",
          )}
        >
          {it.badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <aside className="sidebar w-56 shrink-0 flex flex-col border-r border-line">
      <div data-tauri-drag-region className={isMac ? "h-12 shrink-0" : "h-5 shrink-0"} />
      <div data-tauri-drag-region className="px-5 pb-6 flex items-center gap-2.5">
        <img src={logoMark} alt="" draggable={false} className="size-8 rounded-[9px] shadow-[0_4px_16px_-4px_var(--accent)]" />
        <span className="text-[17px] font-bold tracking-tight">
          Pull<span className="text-gradient">Stream</span>
        </span>
      </div>

      <nav className="px-3 space-y-0.5" aria-label="Main">
        {main.map(renderItem)}
      </nav>
      <div className="mx-5 my-3 h-px bg-line" />
      <nav className="px-3 space-y-0.5" aria-label="Info">
        {secondary.map(renderItem)}
      </nav>

      <div className="mt-auto p-4">
        <div className="rounded-2xl bg-panel/70 border border-line p-3.5">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Gauge className="size-3.5" /> {t("nav.totalSpeed")}
          </div>
          <div className="mt-1 text-[20px] font-bold tabular-nums tracking-tight">{formatSpeed(stats.speed) || "0 B/s"}</div>
          <div className="mt-1 text-[12px] text-muted">{t("nav.activeQueued", { active: stats.active, queued: stats.queued })}</div>
          <WhenDonePicker />
        </div>
      </div>
    </aside>
  );
}

/** Quit or sleep when the queue finishes (applies to this session only). */
function WhenDonePicker() {
  const t = useT();
  const whenDone = useStore((s) => s.whenDone);
  const setWhenDone = useStore((s) => s.setWhenDone);
  const Icon = whenDone === "sleep" ? Moon : whenDone === "quit" ? Power : Clock;
  return (
    <label className="mt-3 pt-3 border-t border-line block text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <Icon className={clsx("size-3.5 shrink-0", whenDone !== "none" && "text-accent")} />
        {t("whenDone.label")}
      </span>
      <select
        value={whenDone}
        onChange={(e) => setWhenDone(e.target.value as WhenDone)}
        className={clsx(
          "mt-1.5 w-full h-8 px-2 rounded-lg bg-panel-2 border border-line outline-none text-[12.5px] font-medium cursor-default focus:border-accent",
          whenDone !== "none" ? "text-accent" : "text-fg",
        )}
      >
        <option value="none">{t("whenDone.none")}</option>
        <option value="quit">{t("whenDone.quit")}</option>
        <option value="sleep">{t("whenDone.sleep")}</option>
      </select>
    </label>
  );
}

// ------------------------------------------------------------------ banners

const LOW_DISK = 2 * 1024 ** 3; // 2 GB

function Banners() {
  const t = useT();
  const online = useStore((s) => s.online);
  const dir = useStore((s) => s.settings?.downloadDir);
  const jobs = useStore((s) => s.jobs);
  const openSettings = useStore((s) => s.openSettings);
  const [free, setFree] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Re-check free space when the folder changes or downloads finish.
  const finishedCount = useMemo(() => Object.values(jobs).filter((j) => j.status === "completed").length, [jobs]);
  useEffect(() => {
    api.diskSpace().then(setFree).catch(() => setFree(null));
  }, [dir, finishedCount]);

  return (
    <AnimatePresence initial={false}>
      {!online && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          role="status"
          className="mb-3 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-warn/10 border border-warn/30 text-[13px]"
        >
          <WifiOff className="size-4 text-warn shrink-0" /> {t("banner.offline")}
        </motion.div>
      )}
      {free != null && free < LOW_DISK && !dismissed && (
        <motion.div
          key="disk"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          role="status"
          className="mb-3 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-danger/10 border border-danger/30 text-[13px]"
        >
          <HardDrive className="size-4 text-danger shrink-0" />
          <span className="flex-1">{t("banner.lowDisk", { free: formatBytes(free) })}</span>
          <Button size="sm" onClick={() => openSettings("downloads")}>
            {t("banner.openSettings")}
          </Button>
          <button onClick={() => setDismissed(true)} aria-label={t("preview.close")} className="p-1 text-muted hover:text-fg cursor-default">
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ------------------------------------------------------------------ toasts

function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            role={t.kind === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="pointer-events-auto flex items-center gap-3 pl-3.5 pr-2 py-2.5 rounded-xl bg-panel border border-line shadow-[0_10px_40px_-10px_#0006] max-w-md"
          >
            {t.kind === "success" && <CheckCircle2 className="size-4 text-success shrink-0" />}
            {t.kind === "error" && <AlertCircle className="size-4 text-danger shrink-0" />}
            {t.kind === "info" && <Info className="size-4 text-accent shrink-0" />}
            <span className="text-[13px] flex-1 min-w-0 break-words line-clamp-3">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
                className="text-[13px] font-semibold text-accent px-2 h-7 rounded-md hover:bg-accent-soft cursor-default"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-muted hover:text-fg p-1 cursor-default">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ hooks

function useTheme(theme: "system" | "light" | "dark") {
  // Match the native window appearance to the app theme. On macOS this also
  // switches the translucent sidebar material (it follows the window's
  // appearance, not our CSS), so a Light app on a Dark Mac stays readable.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => {});
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

/** Run a menu/shortcut action by id (shared by the macOS menu bar and key handlers). */
function useRunAction() {
  const submit = useSubmitUrls();
  return async (id: string) => {
    const s = useStore.getState();
    switch (id) {
      case "about":
      case "terms":
        return s.setView(id);
      case "view-downloads":
        return s.setView("downloads");
      case "view-history":
        return s.setView("history");
      case "settings":
        return s.openSettings();
      case "new-download":
        return s.requestFocusUrl();
      case "paste-download": {
        const text = (await readText().catch(() => "")) ?? "";
        if (extractUrls(text).length) submit(text);
        else s.requestFocusUrl();
        return;
      }
      case "find":
        return s.requestFocusSearch();
      case "open-folder":
        return api.openDownloadDir().catch(() => {});
      case "pause-all":
        return api.pauseAll();
      case "resume-all":
        return api.resumeAll();
      case "retry-failed":
        return api.retryFailed();
      case "clear-finished":
        return api.clearFinished();
      case "check-updates":
        return checkForUpdates(true);
      case "help":
        return open(HELP_URL);
      case "diagnostics":
        try {
          await writeText(await api.diagnostics());
          s.toast({ kind: "success", text: tNow("settings.diagnosticsCopied") });
        } catch (e) {
          s.toast({ kind: "error", text: errorText(e) });
        }
        return;
    }
  };
}

/**
 * macOS: actions come from the native menu bar (with standard shortcuts).
 * Windows/Linux: the same shortcuts are handled here.
 */
function useMenuAndShortcuts() {
  const run = useRunAction();
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const un = listen<string>("menu", (e) => runRef.current(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (isMac) return; // the menu bar owns these shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (!modKey(e)) return;
      const k = e.key.toLowerCase();
      const map: Record<string, string> = {
        ",": "settings",
        n: "new-download",
        "1": "view-downloads",
        "2": "view-history",
        f: "find",
      };
      if (e.shiftKey && k === "v" && !isTyping(e)) return (e.preventDefault(), runRef.current("paste-download"));
      if (e.shiftKey && k === "o") return (e.preventDefault(), runRef.current("open-folder"));
      if (map[k] && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        runRef.current(map[k]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Dock badge (macOS/Linux) and taskbar/Dock progress bar (all platforms). */
function useTaskbarProgress() {
  const jobs = useStore((s) => s.jobs);
  const last = useRef("");
  useEffect(() => {
    const list = Object.values(jobs);
    const running = list.filter((j) => isActive(j.status));
    const waiting = list.filter((j) => j.status === "queued").length;
    const count = running.length + waiting;
    const progress = running.length ? Math.round(running.reduce((a, j) => a + j.progress, 0) / running.length) : 0;
    const key = `${count}:${running.length ? progress : -1}`;
    if (key === last.current) return;
    last.current = key;
    const win = getCurrentWindow();
    win.setBadgeCount(count || undefined).catch(() => {});
    win
      .setProgressBar(running.length ? { status: ProgressBarStatus.Normal, progress } : { status: ProgressBarStatus.None })
      .catch(() => {});
  }, [jobs]);
}

/** Chime when a download completes. */
function useCompletionSound(enabled: boolean) {
  const jobs = useStore((s) => s.jobs);
  const prev = useRef<Record<string, string>>({});
  useEffect(() => {
    let finished = false;
    for (const j of Object.values(jobs)) {
      const before = prev.current[j.id];
      if (before && before !== "completed" && j.status === "completed") finished = true;
      prev.current[j.id] = j.status;
    }
    if (finished && enabled) playChime();
  }, [jobs, enabled]);
}

function useOnlineStatus() {
  useEffect(() => {
    const set = () => useStore.getState().setOnline(navigator.onLine);
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);
}

/** When the window gains focus, offer to fetch a freshly copied link. */
function useClipboardWatch(enabled: boolean) {
  const last = useRef<string>("");
  useEffect(() => {
    if (!enabled) return;
    const check = async () => {
      try {
        const text = (await readText())?.trim() ?? "";
        if (!text || text === last.current) return;
        last.current = text;
        const urls = extractUrls(text);
        const { preview, fetchInfo, toast, jobs } = useStore.getState();
        if (urls.length !== 1 || urls[0] === preview.url) return;
        if (Object.values(jobs).some((j) => j.url === urls[0])) return;
        const url = urls[0];
        toast({
          kind: "info",
          text: tNow("url.copiedLink", { url: url.length > 60 ? url.slice(0, 60) + "…" : url }),
          action: {
            label: tNow("url.fetch"),
            run: () => fetchInfo(url, !(/[?&]list=/.test(url) && !/[?&]v=/.test(url))),
          },
        });
      } catch {
        /* clipboard unavailable */
      }
    };
    // Seed with the current clipboard so we don't prompt for an old link on launch.
    readText()
      .then((t) => (last.current = t?.trim() ?? ""))
      .catch(() => {});
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [enabled]);
}
