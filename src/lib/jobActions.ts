import { Menu } from "@tauri-apps/api/menu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import { tNow } from "../i18n";
import { api, errorText } from "./api";
import { defaultCookieBrowser, explainError } from "./errors";
import { isActive, type Job } from "./types";

const jobsById = (ids: string[]) => {
  const { jobs } = useStore.getState();
  return ids.map((id) => jobs[id]).filter(Boolean) as Job[];
};
const fail = (e: unknown) => useStore.getState().toast({ kind: "error", text: errorText(e) });
const each = (jobs: Job[], f: (j: Job) => Promise<unknown>) => Promise.all(jobs.map(f)).catch(fail);

export const canPause = (j: Job) => isActive(j.status) || j.status === "queued";
export const canResume = (j: Job) => j.status === "paused";
export const canRetry = (j: Job) => j.status === "failed" || j.status === "canceled";
export const isWaiting = (j: Job) => j.status === "queued" || j.status === "paused";
export const isFinished = (j: Job) => j.status === "completed" || j.status === "canceled";

export const actions = {
  pause: (ids: string[]) => each(jobsById(ids).filter(canPause), (j) => api.pause(j.id)),
  resume: (ids: string[]) =>
    each(jobsById(ids).filter((j) => canResume(j) || canRetry(j)), (j) => api.resume(j.id)),
  cancel: (ids: string[]) => each(jobsById(ids).filter((j) => !isFinished(j)), (j) => api.cancel(j.id)),
  remove: (ids: string[]) => api.remove(ids).catch(fail),
  open: (id: string) => api.openFile(id).catch(fail),
  reveal: (id: string) => api.revealFile(id).catch(fail),

  async deleteFiles(ids: string[]) {
    const ok = await ask(tNow("queue.deleteConfirm", { n: ids.length }), {
      title: tNow("queue.deleteTitle"),
      kind: "warning",
      okLabel: tNow("common.delete"),
      cancelLabel: tNow("common.cancel"),
    });
    if (ok) await api.remove(ids, true).catch(fail);
  },

  async copyLinks(ids: string[]) {
    const urls = jobsById(ids).map((j) => j.url);
    await writeText(urls.join("\n")).catch(fail);
    useStore.getState().toast({ kind: "success", text: tNow("queue.copied") });
  },

  /** Move waiting jobs to the front or back of the queue. */
  async move(ids: string[], where: "top" | "bottom") {
    const { jobs } = useStore.getState();
    const waiting = Object.values(jobs)
      .filter(isWaiting)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((j) => j.id);
    const moving = waiting.filter((id) => ids.includes(id));
    const rest = waiting.filter((id) => !ids.includes(id));
    await api.reorder(where === "top" ? [...moving, ...rest] : [...rest, ...moving]).catch(fail);
  },

  /** Drop `ids` just before `targetId` in the waiting queue. */
  async moveBefore(ids: string[], targetId: string) {
    const { jobs } = useStore.getState();
    const waiting = Object.values(jobs)
      .filter(isWaiting)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((j) => j.id);
    const moving = waiting.filter((id) => ids.includes(id));
    if (!moving.length || moving.includes(targetId)) return;
    const rest = waiting.filter((id) => !ids.includes(id));
    const at = rest.indexOf(targetId);
    rest.splice(at < 0 ? rest.length : at, 0, ...moving);
    await api.reorder(rest).catch(fail);
  },

  /** One-click fix for an explained error, then retry. */
  async fix(job: Job) {
    const ex = explainError(job.error);
    const store = useStore.getState();
    try {
      if (ex.fix === "cookies") {
        const browser = store.settings?.cookiesBrowser && store.settings.cookiesBrowser !== "none"
          ? store.settings.cookiesBrowser
          : defaultCookieBrowser();
        await store.saveSettings({ cookiesBrowser: browser });
        store.toast({ kind: "info", text: tNow("err.cookiesOn", { browser }) });
      } else if (ex.fix === "update") {
        await api.updateYtdlp();
        store.toast({ kind: "info", text: tNow("err.updated") });
      } else if (ex.fix === "settings") {
        store.openSettings("downloads");
        return;
      }
      await api.resume(job.id);
    } catch (e) {
      fail(e);
    }
  },
};

/** Native right-click menu for the selected downloads. */
export async function showContextMenu(ids: string[]) {
  const t = tNow;
  const jobs = jobsById(ids);
  if (!jobs.length) return;
  const one = jobs.length === 1 ? jobs[0] : null;
  const anyDone = jobs.some((j) => j.status === "completed");

  type Item = { text: string; action: () => void; enabled?: boolean } | { item: "Separator" };
  const items: Item[] = [];
  if (one?.status === "completed") {
    items.push({ text: t("action.open"), action: () => actions.open(one.id) });
  }
  if (one) items.push({ text: t("action.showInFolder"), action: () => actions.reveal(one.id) });
  items.push({ text: t("action.copyLink"), action: () => actions.copyLinks(ids) });
  items.push({ item: "Separator" });

  if (jobs.some(canPause)) items.push({ text: t("action.pause"), action: () => actions.pause(ids) });
  if (jobs.some(canResume)) items.push({ text: t("action.resume"), action: () => actions.resume(ids) });
  if (jobs.some(canRetry)) items.push({ text: t("action.retry"), action: () => actions.resume(ids) });
  if (jobs.some(isWaiting)) {
    items.push({ text: t("action.moveTop"), action: () => actions.move(ids, "top") });
    items.push({ text: t("action.moveBottom"), action: () => actions.move(ids, "bottom") });
  }
  items.push({ item: "Separator" });
  if (jobs.some((j) => !isFinished(j) && j.status !== "failed"))
    items.push({ text: t("action.cancel"), action: () => actions.cancel(ids) });
  items.push({ text: t("action.remove"), action: () => actions.remove(ids) });
  if (anyDone) items.push({ text: t("action.deleteFile"), action: () => actions.deleteFiles(ids) });

  // Drop leading/trailing/double separators left by empty sections.
  const clean = items.filter(
    (it, i, arr) => !("item" in it) || (i > 0 && i < arr.length - 1 && !("item" in arr[i - 1])),
  );
  const menu = await Menu.new({ items: clean });
  await menu.popup();
}
