import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FolderOpen,
  GripVertical,
  History,
  ListVideo,
  Music,
  Pause,
  Play,
  RotateCw,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useStore, type SortKey } from "../store";
import { stageLabel, useT, type T } from "../i18n";
import { api } from "../lib/api";
import { explainError } from "../lib/errors";
import { formatBytes, formatDuration, formatEta, formatSpeed, formatWhen, qualityLabel } from "../lib/format";
import { actions, canPause, canResume, canRetry, isFinished, isWaiting, showContextMenu } from "../lib/jobActions";
import { isMac, MOD, modKey } from "../lib/platform";
import { isActive, type Job, type JobStatus } from "../lib/types";
import { Button, IconButton, Select, Thumb } from "./ui";

type Mode = "downloads" | "history";
type Row =
  | { type: "group"; key: string; title: string; jobs: Job[]; total: number; done: number }
  | { type: "job"; job: Job; nested: boolean };

const inMode = (mode: Mode, j: Job) => (mode === "history" ? isFinished(j) : !isFinished(j));

/** Running first, then waiting (queue order), then failed. */
const rank = (j: Job) =>
  isActive(j.status) ? 0 : j.status === "queued" ? 1 : j.status === "paused" ? 2 : j.status === "failed" ? 3 : 4;

function sorter(key: SortKey): (a: Job, b: Job) => number {
  switch (key) {
    case "queue":
      return (a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt;
    case "added":
      return (a, b) => b.createdAt - a.createdAt;
    case "finished":
      return (a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt);
    case "name":
      return (a, b) => a.title.localeCompare(b.title);
    case "size":
      return (a, b) => (b.totalBytes ?? 0) - (a.totalBytes ?? 0);
  }
}

export function Queue({ mode }: { mode: Mode }) {
  const t = useT();
  const jobsMap = useStore((s) => s.jobs);
  const search = useStore((s) => s.search);
  const sortKey = useStore((s) => s.sort[mode]);
  const collapsed = useStore((s) => s.collapsed);
  const selected = useStore((s) => s.selected);
  const anchor = useStore((s) => s.anchor);
  const { select, toggleSelect, clearSelection } = useStore.getState();

  const all = useMemo(() => Object.values(jobsMap), [jobsMap]);
  const q = search.trim().toLowerCase();

  // Visible jobs in display order.
  const list = useMemo(() => {
    const matches = (j: Job) =>
      !q ||
      j.title.toLowerCase().includes(q) ||
      (j.uploader ?? "").toLowerCase().includes(q) ||
      (j.playlistTitle ?? "").toLowerCase().includes(q);
    return all.filter((j) => inMode(mode, j) && matches(j)).sort(sorter(sortKey));
  }, [all, mode, q, sortKey]);

  // Group playlist items (downloads view, no search) under one header row.
  const rows: Row[] = useMemo(() => {
    if (mode === "history" || q) return list.map((job) => ({ type: "job", job, nested: false }));
    const byPlaylist = new Map<string, Job[]>();
    for (const j of list) if (j.playlistTitle) byPlaylist.set(j.playlistTitle, [...(byPlaylist.get(j.playlistTitle) ?? []), j]);
    const out: Row[] = [];
    const emitted = new Set<string>();
    for (const j of list) {
      const key = j.playlistTitle;
      const members = key ? byPlaylist.get(key)! : null;
      if (!key || !members || members.length < 2) {
        out.push({ type: "job", job: j, nested: false });
        continue;
      }
      if (emitted.has(key)) continue;
      emitted.add(key);
      const everything = all.filter((x) => x.playlistTitle === key);
      out.push({
        type: "group",
        key,
        title: key,
        jobs: members,
        total: everything.length,
        done: everything.filter((x) => x.status === "completed").length,
      });
      if (!collapsed.has(key)) for (const m of members) out.push({ type: "job", job: m, nested: true });
    }
    return out;
  }, [list, all, mode, q, collapsed]);

  const visibleIds = useMemo(
    () => rows.flatMap((r) => (r.type === "job" ? [r.job.id] : [])),
    [rows],
  );

  // Drop selections that are no longer visible.
  useEffect(() => {
    const vis = new Set(visibleIds);
    if ([...selected].some((id) => !vis.has(id))) select([...selected].filter((id) => vis.has(id)), { anchor });
  }, [visibleIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === "group" ? 60 : 96),
    overscan: 6,
    getItemKey: (i) => {
      const r = rows[i];
      return r.type === "group" ? `g:${r.key}` : r.job.id;
    },
  });

  const onRowClick = (e: MouseEvent, id: string) => {
    if (e.shiftKey && anchor) {
      const a = visibleIds.indexOf(anchor);
      const b = visibleIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        select(visibleIds.slice(lo, hi + 1), { additive: modKey(e), anchor });
        return;
      }
    }
    if (modKey(e)) toggleSelect(id);
    else select([id]);
  };

  const onContext = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const ids = selected.has(id) ? [...selected] : [id];
    if (!selected.has(id)) select([id]);
    showContextMenu(ids);
  };

  // Keyboard: arrows move, space pauses/resumes, Enter opens, Delete removes, ⌘A selects all.
  const onKeyDown = (e: KeyboardEvent) => {
    const ids = [...selected];
    const cur = anchor ? visibleIds.indexOf(anchor) : -1;
    const moveTo = (i: number) => {
      const id = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, i))];
      if (!id) return;
      if (e.shiftKey && anchor) {
        const a = visibleIds.indexOf(anchor);
        const b = visibleIds.indexOf(id);
        select(visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1), { anchor });
      } else select([id]);
      const rowIndex = rows.findIndex((r) => r.type === "job" && r.job.id === id);
      if (rowIndex >= 0) virt.scrollToIndex(rowIndex, { align: "auto" });
    };
    if (e.key === "ArrowDown") (e.preventDefault(), moveTo(cur + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), moveTo(cur < 0 ? 0 : cur - 1));
    else if (modKey(e) && e.key.toLowerCase() === "a") (e.preventDefault(), select(visibleIds, { anchor: visibleIds[0] ?? null }));
    else if (e.key === "Escape") clearSelection();
    else if (!ids.length) return;
    else if (e.key === " ") {
      e.preventDefault();
      const jobs = ids.map((id) => jobsMap[id]).filter(Boolean);
      jobs.some(canPause) ? actions.pause(ids) : actions.resume(ids);
    } else if (e.key === "Enter") {
      const j = jobsMap[ids[0]];
      if (j?.status === "completed") actions.open(j.id);
    } else if (e.key === "Delete" || (isMac && e.key === "Backspace")) {
      e.preventDefault();
      actions.remove(ids);
    }
  };

  // Drag to reorder waiting downloads (queue order only).
  const canDrag = mode === "downloads" && sortKey === "queue" && !q;
  const dragIds = useRef<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Toolbar mode={mode} jobs={list} all={all} />

      {selected.size > 1 && <BulkBar ids={[...selected]} />}

      <div
        ref={scrollRef}
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={mode === "history" ? t("nav.history") : t("nav.downloads")}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.target === e.currentTarget && clearSelection()}
        className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2 outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {rows.length === 0 ? (
          <Empty mode={mode} query={search} t={t} />
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const row = rows[v.index];
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virt.measureElement}
                  className="absolute inset-x-0 pb-2"
                  style={{ top: v.start }}
                >
                  {row.type === "group" ? (
                    <GroupRow row={row} collapsed={collapsed.has(row.key)} t={t} />
                  ) : (
                    <div
                      className={clsx(row.nested && "pl-6", dropTarget === row.job.id && "pt-1")}
                      draggable={canDrag && isWaiting(row.job)}
                      onDragStart={(e) => {
                        const ids = selected.has(row.job.id) ? [...selected] : [row.job.id];
                        dragIds.current = ids;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", ids.join(","));
                      }}
                      onDragOver={(e) => {
                        if (!canDrag || !isWaiting(row.job) || !dragIds.current.length) return;
                        e.preventDefault();
                        setDropTarget(row.job.id);
                      }}
                      onDragLeave={() => setDropTarget((d) => (d === row.job.id ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDropTarget(null);
                        actions.moveBefore(dragIds.current, row.job.id);
                        dragIds.current = [];
                      }}
                      onDragEnd={() => {
                        setDropTarget(null);
                        dragIds.current = [];
                      }}
                    >
                      {dropTarget === row.job.id && <div className="h-0.5 mb-1 rounded-full bg-accent" />}
                      <JobCard
                        job={row.job}
                        mode={mode}
                        selected={selected.has(row.job.id)}
                        draggable={canDrag && isWaiting(row.job)}
                        onClick={onRowClick}
                        onContext={onContext}
                        t={t}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {canDrag && all.filter(isWaiting).length > 1 && (
        <div className="pt-2 text-center text-[11px] text-muted">{t("queue.dragHint")}</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ toolbar

function Toolbar({ mode, jobs, all }: { mode: Mode; jobs: Job[]; all: Job[] }) {
  const t = useT();
  const { search, setSearch, sort, setSort, focusSearch } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSearch) inputRef.current?.focus();
  }, [focusSearch]);

  const hasPausable = all.some(canPause);
  const hasPaused = all.some(canResume);
  const hasFailed = all.some((j) => j.status === "failed");
  const finished = all.filter(isFinished);

  const sortOptions: { value: SortKey; label: string }[] =
    mode === "history"
      ? [
          { value: "finished", label: t("queue.sort.finished") },
          { value: "name", label: t("queue.sort.name") },
          { value: "size", label: t("queue.sort.size") },
        ]
      : [
          { value: "queue", label: t("queue.sort.queue") },
          { value: "added", label: t("queue.sort.added") },
          { value: "name", label: t("queue.sort.name") },
          { value: "size", label: t("queue.sort.size") },
        ];

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-panel border border-line w-60 focus-within:border-accent">
        <Search className="size-3.5 text-muted shrink-0" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (setSearch(""), (e.target as HTMLInputElement).blur())}
          placeholder={`${t("queue.search")}  ${MOD}F`}
          aria-label={t("queue.search")}
          className="bg-transparent outline-none text-[13px] flex-1 min-w-0"
        />
        {search && (
          <button onClick={() => setSearch("")} aria-label={t("url.clear")} className="text-muted hover:text-fg cursor-default">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-muted">
        <ArrowDownUp className="size-3.5" />
        <Select value={sort[mode]} onChange={(v) => setSort(mode, v)} options={sortOptions} aria-label={t("queue.sort")} />
      </div>
      <span className="text-[12px] text-muted tabular-nums">{jobs.length}</span>
      <div className="flex-1" />

      {mode === "downloads" ? (
        <>
          {hasFailed && (
            <Button variant="ghost" size="sm" onClick={() => api.retryFailed()}>
              <RotateCw className="size-3.5" /> {t("queue.retryFailed")}
            </Button>
          )}
          {hasPaused && (
            <Button variant="ghost" size="sm" onClick={() => api.resumeAll()}>
              <Play className="size-3.5" /> {t("queue.resumeAll")}
            </Button>
          )}
          {hasPausable && (
            <Button variant="ghost" size="sm" onClick={() => api.pauseAll()}>
              <Pause className="size-3.5" /> {t("queue.pauseAll")}
            </Button>
          )}
        </>
      ) : (
        finished.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => api.clearFinished()}>
            <Trash2 className="size-3.5" /> {t("queue.clearFinished")}
          </Button>
        )
      )}
    </div>
  );
}

function BulkBar({ ids }: { ids: string[] }) {
  const t = useT();
  const jobsMap = useStore((s) => s.jobs);
  const clear = useStore((s) => s.clearSelection);
  const jobs = ids.map((id) => jobsMap[id]).filter(Boolean);
  return (
    <div className="mb-3 flex items-center gap-1 px-3 h-11 rounded-xl bg-accent-soft border border-accent/30">
      <span className="text-[13px] font-semibold text-accent mr-2">{t("queue.selected", { n: ids.length })}</span>
      {jobs.some(canPause) && (
        <Button variant="ghost" size="sm" onClick={() => actions.pause(ids)}>
          <Pause className="size-3.5" /> {t("action.pause")}
        </Button>
      )}
      {jobs.some((j) => canResume(j) || canRetry(j)) && (
        <Button variant="ghost" size="sm" onClick={() => actions.resume(ids)}>
          <Play className="size-3.5" /> {t("action.resume")}
        </Button>
      )}
      {jobs.some(isWaiting) && (
        <Button variant="ghost" size="sm" onClick={() => actions.move(ids, "top")}>
          <Download className="size-3.5" /> {t("action.moveTop")}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => actions.remove(ids)}>
        <X className="size-3.5" /> {t("action.remove")}
      </Button>
      {jobs.some((j) => j.status === "completed") && (
        <Button variant="danger" size="sm" onClick={() => actions.deleteFiles(ids)}>
          <Trash2 className="size-3.5" /> {t("action.deleteFile")}
        </Button>
      )}
      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={clear}>
        {t("action.clearSelection")}
      </Button>
    </div>
  );
}

function Empty({ mode, query, t }: { mode: Mode; query: string; t: T }) {
  const Icon = mode === "history" ? History : Download;
  return (
    <div className="h-full grid place-items-center text-center">
      <div>
        <div className="size-16 mx-auto rounded-2xl gradient-accent grid place-items-center opacity-90 shadow-[0_8px_30px_-6px_var(--accent)]">
          <Icon className="size-7 text-white" />
        </div>
        <div className="mt-4 font-semibold">
          {query ? t("queue.noResults", { q: query }) : mode === "history" ? t("queue.historyEmptyTitle") : t("queue.emptyTitle")}
        </div>
        {!query && (
          <div className="mt-1 text-[13px] text-muted max-w-xs">
            {mode === "history" ? t("queue.historyEmptyHint") : t("queue.emptyHint")}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ rows

function GroupRow({ row, collapsed, t }: { row: Extract<Row, { type: "group" }>; collapsed: boolean; t: T }) {
  const toggle = useStore((s) => s.toggleGroup);
  const select = useStore((s) => s.select);
  const ids = row.jobs.map((j) => j.id);
  // Aggregate progress across the whole playlist (finished items count as 100%).
  const progress =
    (row.done * 100 + row.jobs.reduce((a, j) => a + (j.status === "completed" ? 0 : j.progress), 0)) /
    Math.max(1, row.total);
  const running = row.jobs.some((j) => isActive(j.status));
  const speed = row.jobs.reduce((a, j) => a + (isActive(j.status) ? (j.speed ?? 0) : 0), 0);

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        select(ids);
        showContextMenu(ids);
      }}
      className="h-full flex items-center gap-3 px-3 rounded-2xl bg-panel-2/70 border border-line"
    >
      <button
        onClick={() => toggle(row.key)}
        aria-expanded={!collapsed}
        aria-label={row.title}
        className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-default py-2.5"
      >
        <ChevronRight className={clsx("size-4 text-muted transition-transform shrink-0", !collapsed && "rotate-90")} />
        <ListVideo className="size-4 text-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-[14px]">{row.title}</span>
            <span className="text-[12px] text-muted shrink-0 tabular-nums">{t("queue.groupProgress", { done: row.done, total: row.total })}</span>
            {speed > 0 && <span className="text-[12px] text-muted shrink-0 tabular-nums">· {formatSpeed(speed)}</span>}
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-panel overflow-hidden">
            <div
              className={clsx("h-full rounded-full transition-[width] duration-300", running ? "gradient-accent" : "bg-muted/50")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </button>
      <div className="flex items-center gap-0.5">
        {row.jobs.some(canPause) ? (
          <IconButton title={t("action.pause")} onClick={() => actions.pause(ids)}>
            <Pause className="size-4" />
          </IconButton>
        ) : row.jobs.some((j) => canResume(j) || canRetry(j)) ? (
          <IconButton title={t("action.resume")} onClick={() => actions.resume(ids)}>
            <Play className="size-4" />
          </IconButton>
        ) : null}
        <IconButton title={t("action.cancel")} tone="danger" onClick={() => actions.cancel(ids)}>
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

const statusTone: Record<JobStatus, string> = {
  queued: "text-muted bg-panel-2",
  starting: "text-accent bg-accent-soft",
  downloading: "text-accent bg-accent-soft",
  processing: "text-warn bg-warn/10",
  completed: "text-success bg-success/10",
  failed: "text-danger bg-danger/10",
  paused: "text-muted bg-panel-2",
  canceled: "text-muted bg-panel-2",
};

const JobCard = memo(function JobCard({
  job,
  mode,
  selected,
  draggable,
  onClick,
  onContext,
  t,
}: {
  job: Job;
  mode: Mode;
  selected: boolean;
  draggable: boolean;
  onClick: (e: MouseEvent, id: string) => void;
  onContext: (e: MouseEvent, id: string) => void;
  t: T;
}) {
  const active = isActive(job.status);
  const showBar = active || job.status === "paused" || job.status === "queued";
  const indeterminate = job.status === "starting" || job.status === "processing";
  const fmt = job.options.kind === "audio" ? job.options.audioFormat.toUpperCase() : qualityLabel(job.options.maxHeight);
  const explained = job.status === "failed" ? explainError(job.error) : null;

  let detail: React.ReactNode = null;
  if (job.status === "downloading") {
    detail = (
      <>
        <span className="tabular-nums font-medium text-fg">{job.progress.toFixed(1)}%</span>
        {job.totalBytes ? (
          <span className="tabular-nums">
            {formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}
          </span>
        ) : null}
        {job.speed ? <span className="tabular-nums">{formatSpeed(job.speed)}</span> : null}
        {job.eta ? <span className="tabular-nums">{t("queue.left", { t: formatEta(job.eta) })}</span> : null}
        {job.stage && job.stage !== "Downloading" && <span>{stageLabel(t, job.stage)}</span>}
      </>
    );
  } else if (indeterminate) {
    detail = <span>{stageLabel(t, job.stage)}</span>;
  } else if (job.status === "completed") {
    detail = (
      <>
        <span>{formatWhen(job.finishedAt)}</span>
        {job.totalBytes ? <span>{formatBytes(job.totalBytes)}</span> : null}
        <span className="truncate" title={job.filePath ?? job.outputDir}>
          {job.filePath ? job.filePath.split(/[\\/]/).pop() : job.outputDir}
        </span>
      </>
    );
  } else if (job.status === "paused" && job.progress > 0) {
    detail = <span className="tabular-nums">{t("queue.pausedAt", { p: job.progress.toFixed(1) })}</span>;
  } else if (job.status === "queued") {
    detail = (
      <span className="inline-flex items-center gap-1">
        <Clock className="size-3" /> {t("queue.waiting")}
      </span>
    );
  } else if (job.status === "canceled") {
    detail = <span>{formatWhen(job.finishedAt ?? job.createdAt)}</span>;
  }

  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={(e) => onClick(e, job.id)}
      onDoubleClick={() => job.status === "completed" && actions.open(job.id)}
      onContextMenu={(e) => onContext(e, job.id)}
      className={clsx(
        "group relative flex items-center gap-3 p-3 pr-2 rounded-2xl border transition-colors",
        selected ? "bg-accent-soft border-accent/50" : active ? "bg-panel border-accent/25" : "bg-panel border-line hover:border-muted/40",
      )}
    >
      {draggable && (
        <GripVertical
          className="absolute left-0.5 top-1/2 -translate-y-1/2 size-3.5 text-muted/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab"
          aria-hidden
        />
      )}
      <Thumb src={job.thumbnail} className="h-[68px] aspect-video rounded-xl">
        {!job.thumbnail && (
          <div className="absolute inset-0 grid place-items-center text-muted">
            {job.options.kind === "audio" ? <Music className="size-5" /> : <Download className="size-5" />}
          </div>
        )}
        {job.status === "completed" && (
          <div className="absolute inset-0 bg-black/30 grid place-items-center">
            <CheckCircle2 className="size-6 text-white drop-shadow" />
          </div>
        )}
        {job.duration != null && job.status !== "completed" && (
          <span className="absolute bottom-1 right-1 px-1 rounded bg-black/75 text-white text-[10px] font-medium">
            {formatDuration(job.duration)}
          </span>
        )}
      </Thumb>

      <div className="flex-1 min-w-0">
        <div className="truncate font-medium text-[14px]" title={job.title}>
          {job.title}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[12px] text-muted">
          <span className={clsx("px-1.5 py-px rounded-md text-[11px] font-semibold", statusTone[job.status])}>
            {t(`status.${job.status}`)}
          </span>
          <span className="px-1.5 py-px rounded-md bg-panel-2 border border-line text-[11px] font-medium">{fmt}</span>
          {job.options.section && (
            <span className="px-1.5 py-px rounded-md bg-panel-2 border border-line text-[11px] font-medium tabular-nums">
              {formatDuration(job.options.section.start)}–{formatDuration(job.options.section.end)}
            </span>
          )}
          {mode === "history" && job.playlistTitle && (
            <span className="inline-flex items-center gap-1 truncate max-w-48" title={job.playlistTitle}>
              <ListVideo className="size-3 shrink-0" /> <span className="truncate">{job.playlistTitle}</span>
            </span>
          )}
          {job.uploader && !job.playlistTitle && <span className="truncate max-w-40">{job.uploader}</span>}
        </div>

        {explained ? (
          <div className="mt-1.5 flex items-center gap-2 min-w-0">
            <AlertCircle className="size-3.5 text-danger shrink-0" />
            <span className="text-[12px] min-w-0 truncate">
              <span className="font-medium text-danger">{t(explained.title)}.</span>{" "}
              <span className="text-muted" title={job.error ?? ""}>
                {t(explained.hint)}
              </span>
            </span>
            {explained.fix && explained.fixLabel && (
              <Button
                size="sm"
                className="h-6 px-2 text-[12px] shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.fix(job);
                }}
              >
                <Wrench className="size-3" /> {t(explained.fixLabel)}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-3 text-[12px] text-muted min-w-0 whitespace-nowrap">{detail}</div>
        )}

        {showBar && (
          <div
            className="mt-2 h-1.5 rounded-full bg-panel-2 overflow-hidden relative"
            role="progressbar"
            aria-valuenow={Math.round(job.progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {indeterminate ? (
              <div className={clsx("progress-indeterminate rounded-full", job.status === "processing" ? "bg-warn" : "gradient-accent")} />
            ) : (
              <div
                className={clsx(
                  "h-full rounded-full relative overflow-hidden transition-[width] duration-300 ease-out",
                  job.status === "paused" || job.status === "queued" ? "bg-muted/50" : "gradient-accent progress-sheen",
                )}
                style={{ width: `${Math.max(job.progress, job.status === "downloading" ? 1 : 0)}%` }}
              />
            )}
          </div>
        )}
      </div>

      <div
        className={clsx("flex items-center gap-0.5 transition-opacity", selected ? "opacity-100" : "opacity-60 group-hover:opacity-100")}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {canPause(job) && (
          <IconButton title={t("action.pause")} onClick={() => actions.pause([job.id])}>
            <Pause className="size-4" />
          </IconButton>
        )}
        {canResume(job) && (
          <IconButton title={t("action.resume")} onClick={() => actions.resume([job.id])}>
            <Play className="size-4" />
          </IconButton>
        )}
        {canRetry(job) && (
          <IconButton title={t("action.retry")} onClick={() => actions.resume([job.id])}>
            <RotateCw className="size-4" />
          </IconButton>
        )}
        {job.status === "completed" && (
          <IconButton title={t("action.play")} onClick={() => actions.open(job.id)}>
            <Play className="size-4" />
          </IconButton>
        )}
        <IconButton title={t("action.showInFolder")} onClick={() => actions.reveal(job.id)}>
          <FolderOpen className="size-4" />
        </IconButton>
        {!isFinished(job) && job.status !== "failed" ? (
          <IconButton title={t("action.cancel")} tone="danger" onClick={() => actions.cancel([job.id])}>
            <X className="size-4" />
          </IconButton>
        ) : (
          <IconButton title={t("action.remove")} tone="danger" onClick={() => actions.remove([job.id])}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
});
