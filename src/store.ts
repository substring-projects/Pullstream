import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, errorText } from "./lib/api";
import type { Job, MediaInfo, Settings, ToolStatus } from "./lib/types";

export type View = "downloads" | "settings" | "about" | "terms";
export type Filter = "all" | "active" | "completed" | "failed";

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
  filter: Filter;
  preview: Preview;
  toasts: Toast[];
  /** null until checked */
  tools: ToolStatus | null;
  /** User chose "Skip for now" on the setup screen. */
  setupSkipped: boolean;

  init: () => Promise<void>;
  setView: (v: View) => void;
  setFilter: (f: Filter) => void;
  fetchInfo: (url: string, noPlaylist?: boolean) => Promise<void>;
  clearPreview: () => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  refreshTools: () => Promise<ToolStatus>;
  setTools: (t: ToolStatus) => void;
  skipSetup: () => void;
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
  filter: "all",
  preview: { url: "", loading: false, info: null, error: null },
  toasts: [],
  tools: null,
  setupSkipped: false,

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
        for (const id of e.payload) {
          delete jobs[id];
          delete pending[id];
        }
        return { jobs };
      });
    });

    const [jobs, settings, tools] = await Promise.all([
      api.getJobs(),
      api.getSettings(),
      api.toolStatus(),
    ]);
    set({
      jobs: Object.fromEntries(jobs.map((j) => [j.id, j])),
      settings,
      tools,
      ready: true,
    });
  },

  setView: (view) => set({ view }),
  setFilter: (filter) => set({ filter }),

  fetchInfo: async (url, noPlaylist = false) => {
    const seq = ++fetchSeq;
    set({ preview: { url, loading: true, info: null, error: null } });
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
}));
