import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, type WhenDone } from "./lib/api";
import type { Job, MediaInfo, Settings, ToolStatus } from "./lib/types";

export type View = "downloads" | "history" | "settings" | "about" | "terms";
export type SortKey = "queue" | "added" | "finished" | "name" | "size";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
  action?: { label: string; run: () => void };
}

interface Preview {
  url: string;
  loading: boolean;
  info: MediaInfo | null;
  error: string | null;
}

interface State {
  ready: boolean;
  jobs: Record<string, Job>;
  settings: Settings | null;
  view: View;
  preview: Preview;
  toasts: Toast[];
  /** null until checked */
  tools: ToolStatus | null;
  /** User chose "Skip for now" on the setup screen. */
  setupSkipped: boolean;

  // queue UI
  selected: Set<string>;
  /** Anchor for shift-click range selection. */
  anchor: string | null;
  search: string;
  sort: Record<"downloads" | "history", SortKey>;
  collapsed: Set<string>;
  whenDone: WhenDone;
  online: boolean;
  /** Bumped to ask the link field / search box to take focus. */
  focusUrl: number;
  focusSearch: number;
  settingsTab: string;

  init: () => Promise<void>;
  setView: (v: View) => void;
  fetchInfo: (url: string, noPlaylist?: boolean) => Promise<void>;
  clearPreview: () => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  setSettings: (s: Settings) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  refreshTools: () => Promise<ToolStatus>;
  setTools: (t: ToolStatus) => void;
  skipSetup: () => void;

  select: (ids: string[], opts?: { additive?: boolean; anchor?: string | null }) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setSearch: (q: string) => void;
  setSort: (list: "downloads" | "history", key: SortKey) => void;
  toggleGroup: (key: string) => void;
  setWhenDone: (w: WhenDone) => void;
  setOnline: (v: boolean) => void;
  requestFocusUrl: () => void;
  requestFocusSearch: () => void;
  openSettings: (tab?: string) => void;
}

export const missingTools = (t: ToolStatus | null) =>
  t ? (["ytdlp", "ffmpeg", "deno"] as const).filter((k) => !t[k].path) : [];

let toastId = 0;
let fetchSeq = 0;
let initialized = false;

export const useStore = create<State>((set, get) => ({
  ready: false,
  jobs: {},
  settings: null,
  view: "downloads",
  preview: { url: "", loading: false, info: null, error: null },
  toasts: [],
  tools: null,
  setupSkipped: false,
  selected: new Set(),
  anchor: null,
  search: "",
  sort: { downloads: "queue", history: "finished" },
  collapsed: new Set(),
  whenDone: "none",
  online: navigator.onLine,
  focusUrl: 0,
  focusSearch: 0,
  settingsTab: "general",

  init: async () => {
    if (initialized) return;
    initialized = true;

    // Progress events arrive often (several jobs × ~6/s). Buffer them and
    // apply once per animation frame so React renders at most 60×/s.
    let pending: Record<string, Job> = {};
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const batch = pending;
      pending = {};
      set((s) => ({ jobs: { ...s.jobs, ...batch } }));
    };
    await listen<Job>("job-updated", (e) => {
      pending[e.payload.id] = e.payload;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    });
    await listen<string[]>("jobs-removed", (e) => {
      set((s) => {
        const jobs = { ...s.jobs };
        const selected = new Set(s.selected);
        for (const id of e.payload) {
          delete jobs[id];
          delete pending[id];
          selected.delete(id);
        }
        return { jobs, selected };
      });
    });
    // The "when finished" action is one-shot; the backend resets it.
    await listen("queue-finished", () => set({ whenDone: "none" }));

    const [jobs, settings, tools, whenDone] = await Promise.all([
      api.getJobs(),
      api.getSettings(),
      api.toolStatus(),
      api.getWhenDone().catch(() => "none" as WhenDone),
    ]);
    set({
      jobs: Object.fromEntries(jobs.map((j) => [j.id, j])),
      settings,
      tools,
      whenDone,
      ready: true,
    });
  },

  setView: (view) => set({ view, selected: new Set(), anchor: null, search: "" }),

  fetchInfo: async (url, noPlaylist = false) => {
    const seq = ++fetchSeq;
    set({ view: "downloads", preview: { url, loading: true, info: null, error: null } });
    try {
      const info = await api.fetchInfo(url, noPlaylist);
      if (seq !== fetchSeq) return;
      set({ preview: { url, loading: false, info, error: null } });
    } catch (e) {
      if (seq !== fetchSeq) return;
      set({ preview: { url, loading: false, info: null, error: errorText(e) } });
    }
  },

  clearPreview: () => {
    fetchSeq++;
    set({ preview: { url: "", loading: false, info: null, error: null } });
  },

  saveSettings: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      await api.saveSettings(next);
    } catch (e) {
      get().toast({ kind: "error", text: errorText(e) });
    }
  },
  setSettings: (settings) => set({ settings }),

  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.action ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  refreshTools: async () => {
    const tools = await api.toolStatus();
    set({ tools });
    return tools;
  },
  setTools: (tools) => set({ tools }),
  skipSetup: () => set({ setupSkipped: true }),

  select: (ids, opts) =>
    set((s) => {
      const selected = opts?.additive ? new Set(s.selected) : new Set<string>();
      for (const id of ids) selected.add(id);
      return { selected, anchor: opts?.anchor !== undefined ? opts.anchor : (ids[ids.length - 1] ?? null) };
    }),
  toggleSelect: (id) =>
    set((s) => {
      const selected = new Set(s.selected);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      return { selected, anchor: id };
    }),
  clearSelection: () => set({ selected: new Set(), anchor: null }),
  setSearch: (search) => set({ search }),
  setSort: (list, key) => set((s) => ({ sort: { ...s.sort, [list]: key } })),
  toggleGroup: (key) =>
    set((s) => {
      const collapsed = new Set(s.collapsed);
      collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
      return { collapsed };
    }),
  setWhenDone: (whenDone) => {
    set({ whenDone });
    api.setWhenDone(whenDone).catch(() => {});
  },
  setOnline: (online) => set({ online }),
  requestFocusUrl: () => set((s) => ({ view: "downloads", focusUrl: s.focusUrl + 1 })),
  requestFocusSearch: () =>
    set((s) => ({
      view: s.view === "history" ? "history" : "downloads",
      focusSearch: s.focusSearch + 1,
    })),
  openSettings: (tab) => set({ view: "settings", settingsTab: tab ?? get().settingsTab }),
}));
