import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../store";
import { tNow } from "../i18n";
import { errorText } from "./api";

/**
 * In-app updates via Tauri's updater. Releases publish a signed
 * `latest.json` (see .github/workflows/release.yml); the app checks it
 * quietly at launch and on demand from the menu / Settings.
 */
interface UpdateState {
  available: { version: string; current: string; notes: string } | null;
  progress: number | null; // 0..100 while downloading
  whatsNew: { version: string; notes: string } | null;
  dismiss: () => void;
  closeWhatsNew: () => void;
}

export const useUpdates = create<UpdateState>((set) => ({
  available: null,
  progress: null,
  whatsNew: null,
  dismiss: () => set({ available: null, progress: null }),
  closeWhatsNew: () => set({ whatsNew: null }),
}));

let pending: Update | null = null;
const NOTES_KEY = "pullstream.pendingNotes";
const SEEN_KEY = "pullstream.lastVersion";

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/** `manual` shows "up to date" / errors; the launch check stays silent. */
export async function checkForUpdates(manual = false) {
  const toast = useStore.getState().toast;
  if (manual) toast({ kind: "info", text: tNow("update.checking") });
  try {
    const update = await check();
    if (!update) {
      if (manual) toast({ kind: "success", text: tNow("update.upToDate", { v: await getVersion() }) });
      return;
    }
    pending = update;
    useUpdates.setState({
      available: { version: update.version, current: update.currentVersion, notes: update.body ?? "" },
    });
  } catch (e) {
    if (manual) toast({ kind: "error", text: tNow("update.failed", { e: errorText(e) }) });
  }
}

export async function installUpdate() {
  if (!pending) return;
  let total = 0;
  let done = 0;
  try {
    // Keep the notes so the next launch can show "What's new".
    storage.set(NOTES_KEY, pending.body ?? "");
    useUpdates.setState({ progress: 0 });
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      if (ev.event === "Progress") {
        done += ev.data.chunkLength;
        useUpdates.setState({ progress: total ? Math.round((done / total) * 100) : null });
      }
    });
    await relaunch();
  } catch (e) {
    useUpdates.setState({ progress: null });
    useStore.getState().toast({ kind: "error", text: tNow("update.failed", { e: errorText(e) }) });
  }
}

/** After an update, show what changed once. */
export async function showWhatsNewIfUpdated() {
  const version = await getVersion();
  const last = storage.get(SEEN_KEY);
  storage.set(SEEN_KEY, version);
  if (last && last !== version) {
    useUpdates.setState({ whatsNew: { version, notes: storage.get(NOTES_KEY) ?? "" } });
    storage.set(NOTES_KEY, "");
  }
}
