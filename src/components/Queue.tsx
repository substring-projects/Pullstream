import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  ListVideo,
  Music,
  Pause,
  Play,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useStore, type Filter } from "../store";
import { api, errorText } from "../lib/api";
import { formatBytes, formatDuration, formatEta, formatSpeed, qualityLabel } from "../lib/format";
import { isActive, type Job, type JobStatus } from "../lib/types";
import { Button, IconButton, Thumb } from "./ui";

const IN_PROGRESS: JobStatus[] = ["queued", "starting", "downloading", "processing", "paused"];

const matches = (f: Filter, s: JobStatus) =>
  f === "all" ||
  (f === "active" && IN_PROGRESS.includes(s)) ||
  (f === "completed" && s === "completed") ||
  (f === "failed" && (s === "failed" || s === "canceled"));

/** Running first, then waiting (in queue order), then finished (newest first). */
function rank(j: Job): number {
  if (isActive(j.status)) return 0;
  if (j.status === "queued") return 1;
  if (j.status === "paused") return 2;
  if (j.status === "failed") return 3;
  return 4;
}

export function Queue() {
  const jobsMap = useStore((s) => s.jobs);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);

  const all = useMemo(() => Object.values(jobsMap), [jobsMap]);
  // Sort order only depends on status, so recompute it cheaply.
  const jobs = useMemo(
    () =>
      all
        .filter((j) => matches(filter, j.status))
        .sort((a, b) => {
          const r = rank(a) - rank(b);
          if (r) return r;
          if (rank(a) === 4) return (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt);
          return a.createdAt - b.createdAt;
        }),
    [all, filter],
  );

  const counts = useMemo(() => {
    const c = { all: all.length, active: 0, completed: 0, failed: 0 };
    for (const j of all) {
      if (IN_PROGRESS.includes(j.status)) c.active++;
      else if (j.status === "completed") c.completed++;
      else c.failed++;
    }
    return c;
  }, [all]);

  const hasPaused = all.some((j) => j.status === "paused");
  const hasRunning = all.some((j) => isActive(j.status) || j.status === "queued");
  const hasFailed = all.some((j) => j.status === "failed");

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (i) => jobs[i].id,
  });

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "In progress" },
    { id: "completed", label: "Completed" },
    { id: "failed", label: "Failed" },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1 mb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={clsx(
              "h-8 px-3 rounded-lg text-[13px] font-medium transition-colors cursor-default inline-flex items-center gap-1.5",
              filter === t.id ? "bg-panel text-fg shadow-[var(--shadow)] border border-line" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
            <span className={clsx("text-[11px] tabular-nums", filter === t.id ? "text-accent" : "text-muted")}>
              {counts[t.id]}
            </span>
          </button>
        ))}
        <div className="flex-1" />
        {hasFailed && (
          <Button variant="ghost" size="sm" onClick={() => api.retryFailed()}>
            <RotateCw className="size-3.5" /> Retry failed
          </Button>
        )}
        {hasPaused && (
          <Button variant="ghost" size="sm" onClick={() => api.resumeAll()}>
            <Play className="size-3.5" /> Resume all
          </Button>
        )}
        {hasRunning && (
          <Button variant="ghost" size="sm" onClick={() => api.pauseAll()}>
            <Pause className="size-3.5" /> Pause all
          </Button>
        )}
        {counts.completed > 0 && (
          <Button variant="ghost" size="sm" onClick={() => api.clearFinished()}>
            <Trash2 className="size-3.5" /> Clear finished
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
        {jobs.length === 0 ? (
          <Empty filter={filter} />
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((row) => (
              <div
                key={row.key}
                className="absolute inset-x-0 pb-2"
                style={{ top: row.start, height: row.size }}
              >
                <JobCard job={jobs[row.index]} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ filter }: { filter: Filter }) {
  return (
    <div className="h-full grid place-items-center text-center">
      <div>
        <div className="size-16 mx-auto rounded-2xl gradient-accent grid place-items-center opacity-90 shadow-[0_8px_30px_-6px_var(--accent)]">
          <Download className="size-7 text-white" />
        </div>
        <div className="mt-4 font-semibold">
          {filter === "all" ? "No downloads yet" : "Nothing here"}
        </div>
        <div className="mt-1 text-[13px] text-muted max-w-xs">
          {filter === "all"
            ? "Paste a link above, or drop one anywhere on the window. Playlists work too."
            : "Downloads matching this filter will show up here."}
        </div>
      </div>
    </div>
  );
}

const statusMeta: Record<JobStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "text-muted bg-panel-2" },
  starting: { label: "Starting", cls: "text-accent bg-accent-soft" },
  downloading: { label: "Downloading", cls: "text-accent bg-accent-soft" },
  processing: { label: "Processing", cls: "text-warn bg-warn/10" },
  completed: { label: "Done", cls: "text-success bg-success/10" },
  failed: { label: "Failed", cls: "text-danger bg-danger/10" },
  paused: { label: "Paused", cls: "text-muted bg-panel-2" },
  canceled: { label: "Canceled", cls: "text-muted bg-panel-2" },
};

const JobCard = memo(function JobCard({ job }: { job: Job }) {
  const toast = useStore((s) => s.toast);
  const run = (p: Promise<unknown>) => p.catch((e) => toast({ kind: "error", text: errorText(e) }));
  const meta = statusMeta[job.status];
  const active = isActive(job.status);
  const showBar = active || job.status === "paused" || job.status === "queued";
  const indeterminate = job.status === "starting" || job.status === "processing";

  const fmt =
    job.options.kind === "audio" ? job.options.audioFormat.toUpperCase() : qualityLabel(job.options.maxHeight);

  let detail: React.ReactNode;
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
        {job.eta ? <span className="tabular-nums">{formatEta(job.eta)}</span> : null}
        {job.stage && job.stage !== "Downloading" && <span>{job.stage}</span>}
      </>
    );
  } else if (job.status === "processing" || job.status === "starting") {
    detail = <span>{job.stage ?? "Working…"}</span>;
  } else if (job.status === "failed") {
    detail = (
      <span className="text-danger truncate selectable" title={job.error ?? ""}>
        {job.error ?? "Download failed"}
      </span>
    );
  } else if (job.status === "completed") {
    detail = (
      <>
        {job.totalBytes ? <span>{formatBytes(job.totalBytes)}</span> : null}
        <span className="truncate" title={job.filePath ?? job.outputDir}>
          {job.filePath ? job.filePath.split(/[\\/]/).pop() : job.outputDir}
        </span>
      </>
    );
  } else if (job.status === "paused" && job.progress > 0) {
    detail = <span className="tabular-nums">{job.progress.toFixed(1)}% — paused</span>;
  } else if (job.status === "queued") {
    detail = <span className="inline-flex items-center gap-1"><Clock className="size-3" /> Waiting for a free slot</span>;
  }

  return (
    <div
      onDoubleClick={() => job.status === "completed" && run(api.openFile(job.id))}
      className={clsx(
        "group h-full flex items-center gap-4 p-3 pr-2 rounded-2xl bg-panel border transition-colors",
        active ? "border-accent/30" : "border-line hover:border-muted/40",
      )}
    >
      <Thumb src={job.thumbnail} className="h-full aspect-video rounded-xl">
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
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[14px]" title={job.title}>
            {job.title}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[12px] text-muted">
          <span className={clsx("px-1.5 py-px rounded-md text-[11px] font-semibold", meta.cls)}>{meta.label}</span>
          <span className="px-1.5 py-px rounded-md bg-panel-2 border border-line text-[11px] font-medium">{fmt}</span>
          {job.playlistTitle && (
            <span className="inline-flex items-center gap-1 truncate max-w-48" title={job.playlistTitle}>
              <ListVideo className="size-3 shrink-0" /> <span className="truncate">{job.playlistTitle}</span>
            </span>
          )}
          {job.uploader && !job.playlistTitle && <span className="truncate max-w-40">{job.uploader}</span>}
        </div>

        <div className="mt-2 flex items-center gap-3 text-[12px] text-muted min-w-0 whitespace-nowrap">{detail}</div>

        {showBar && (
          <div className="mt-2 h-1.5 rounded-full bg-panel-2 overflow-hidden relative">
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

      <div className="flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
        {(active || job.status === "queued") && (
          <IconButton title="Pause" onClick={() => run(api.pause(job.id))}>
            <Pause className="size-4" />
          </IconButton>
        )}
        {job.status === "paused" && (
          <IconButton title="Resume" onClick={() => run(api.resume(job.id))}>
            <Play className="size-4" />
          </IconButton>
        )}
        {(job.status === "failed" || job.status === "canceled") && (
          <IconButton title="Retry" onClick={() => run(api.resume(job.id))}>
            <RotateCw className="size-4" />
          </IconButton>
        )}
        {job.status === "completed" && (
          <IconButton title="Play" onClick={() => run(api.openFile(job.id))}>
            <Play className="size-4" />
          </IconButton>
        )}
        <IconButton title="Show in folder" onClick={() => run(api.revealFile(job.id))}>
          <FolderOpen className="size-4" />
        </IconButton>
        {active || job.status === "queued" || job.status === "paused" ? (
          <IconButton title="Cancel" tone="danger" onClick={() => run(api.cancel(job.id))}>
            <X className="size-4" />
          </IconButton>
        ) : (
          <IconButton title="Remove from list" tone="danger" onClick={() => run(api.remove([job.id]))}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
});
