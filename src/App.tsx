import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileText,
  Gauge,
  HelpCircle,
  Info,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import clsx from "clsx";
import { missingTools, useStore, type View } from "./store";
import { extractUrls, formatSpeed } from "./lib/format";
import { isActive } from "./lib/types";
import { UrlBar } from "./components/UrlBar";
import { PreviewPanel } from "./components/Preview";
import { Queue } from "./components/Queue";
import { SettingsView } from "./components/SettingsView";
import { AboutView } from "./components/AboutView";
import { TermsView } from "./components/TermsView";
import { HELP_URL, open } from "./lib/links";
import { SetupScreen } from "./components/SetupScreen";

export default function App() {
  const { init, ready, view, settings, tools, setupSkipped } = useStore();

  useEffect(() => {
    init().catch((e) => console.error(e));
  }, [init]);

  useTheme(settings?.theme ?? "system");
  useClipboardWatch(!!settings?.clipboardWatch);

  if (ready && missingTools(tools).length > 0 && !setupSkipped) {
    return (
      <>
        <SetupScreen />
        <Toasts />
      </>
    );
  }

  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Draggable title-bar area (window uses an overlay title bar) */}
        <div data-tauri-drag-region className="h-10 shrink-0" />
        <div className="flex-1 min-h-0 flex flex-col px-7 pb-6">
          {!ready ? null : view === "downloads" ? (
            <>
              <UrlBar />
              <div className="mt-4">
                <PreviewPanel />
              </div>
              <div className="mt-5 flex-1 min-h-0 flex flex-col">
                <Queue />
              </div>
            </>
          ) : view === "settings" ? (
            <SettingsView />
          ) : view === "about" ? (
            <AboutView />
          ) : (
            <TermsView />
          )}
        </div>
      </main>
      <Toasts />
    </div>
  );
}

function Sidebar() {
  const { view, setView, jobs } = useStore();
  const stats = useMemo(() => {
    let active = 0,
      queued = 0,
      speed = 0;
    for (const j of Object.values(jobs)) {
      if (isActive(j.status)) {
        active++;
        speed += j.speed ?? 0;
      } else if (j.status === "queued") queued++;
    }
    return { active, queued, speed };
  }, [jobs]);

  const items: { id: View | "help"; label: string; icon: typeof Download; badge?: number; href?: string }[] = [
    { id: "downloads", label: "Downloads", icon: Download, badge: stats.active + stats.queued || undefined },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "about", label: "About", icon: Info },
    { id: "terms", label: "Terms & Conditions", icon: FileText },
    { id: "help", label: "Help", icon: HelpCircle, href: HELP_URL },
  ];

  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-line bg-panel/60 backdrop-blur">
      <div data-tauri-drag-region className="h-12 shrink-0" />
      <div data-tauri-drag-region className="px-5 pb-6 flex items-center gap-2.5">
        <div className="size-8 rounded-xl gradient-accent grid place-items-center shadow-[0_4px_16px_-4px_var(--accent)]">
          <Download className="size-4 text-white" strokeWidth={2.5} />
        </div>
        <span className="text-[17px] font-bold tracking-tight">
          Pull<span className="text-gradient">Stream</span>
        </span>
      </div>

      <nav className="px-3 space-y-1">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => (it.href ? open(it.href) : setView(it.id as View))}
            title={it.href ? `Opens ${it.href}` : undefined}
            className={clsx(
              "relative w-full flex items-center gap-3 h-10 px-3 rounded-xl text-[14px] font-medium transition-colors cursor-default",
              view === it.id ? "text-fg" : "text-muted hover:text-fg hover:bg-hover",
            )}
          >
            {view === it.id && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-xl bg-panel-2 border border-line"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <it.icon className={clsx("size-4 relative", view === it.id && "text-accent")} />
            <span className="relative flex-1 text-left truncate">{it.label}</span>
            {it.href && <ArrowUpRight className="relative size-3.5 opacity-60" />}
            {it.badge && (
              <span className="relative min-w-5 h-5 px-1.5 rounded-full gradient-accent text-white text-[11px] font-semibold grid place-items-center">
                {it.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="mt-auto p-4">
        <div className="rounded-2xl bg-panel-2 border border-line p-3.5">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Gauge className="size-3.5" /> Total speed
          </div>
          <div className="mt-1 text-[20px] font-bold tabular-nums tracking-tight">
            {formatSpeed(stats.speed) || "0 B/s"}
          </div>
          <div className="mt-1 text-[12px] text-muted">
            {stats.active} active · {stats.queued} queued
          </div>
        </div>
      </div>
    </aside>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
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
            <button onClick={() => dismissToast(t.id)} className="text-muted hover:text-fg p-1 cursor-default">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function useTheme(theme: "system" | "light" | "dark") {
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
          text: `Link copied: ${url.length > 60 ? url.slice(0, 60) + "…" : url}`,
          action: {
            label: "Fetch",
            run: () => {
              useStore.getState().setView("downloads");
              fetchInfo(url, !(/[?&]list=/.test(url) && !/[?&]v=/.test(url)));
            },
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
