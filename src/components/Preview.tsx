import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  Film,
  ListVideo,
  Music,
  RotateCw,
  Search,
  User,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useStore } from "../store";
import { api, errorText } from "../lib/api";
import { formatBytes, formatCount, formatDuration, qualityLabel } from "../lib/format";
import type { DownloadOptions, MediaInfo, MediaKind, PlaylistEntry } from "../lib/types";
import { Button, Chip, IconButton, Segmented, Select, Switch, Thumb } from "./ui";
import { defaultOptions } from "./UrlBar";

const AUDIO_FORMATS = ["mp3", "m4a", "opus", "flac", "wav"];
const HEIGHTS = [null, 2160, 1440, 1080, 720, 480, 360];

const card = "rounded-2xl bg-panel border border-line shadow-[var(--shadow)]";

export function PreviewPanel() {
  const { preview, clearPreview, fetchInfo } = useStore();
  const visible = preview.loading || preview.info || preview.error;

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div
          key={preview.loading ? "loading" : preview.info?.type ?? "error"}
          initial={{ opacity: 0, y: -8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.2 }}
        >
          {preview.loading && <LoadingCard />}
          {preview.error && (
            <div className={clsx(card, "p-4 flex items-start gap-3")}>
              <AlertCircle className="size-5 text-danger shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Couldn't load this link</div>
                <div className="text-[13px] text-muted mt-1 selectable break-words">{preview.error}</div>
              </div>
              <Button size="sm" onClick={() => fetchInfo(preview.url)}>
                <RotateCw className="size-3.5" /> Retry
              </Button>
              <IconButton title="Dismiss" onClick={clearPreview}>
                <X className="size-4" />
              </IconButton>
            </div>
          )}
          {preview.info?.type === "video" && <VideoCard info={preview.info} />}
          {preview.info?.type === "playlist" && <PlaylistCard info={preview.info} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function LoadingCard() {
  return (
    <div className={clsx(card, "p-4 flex gap-5")}>
      <div className="skeleton w-64 aspect-video rounded-xl" />
      <div className="flex-1 space-y-3 py-1">
        <div className="skeleton h-5 w-3/4 rounded-md" />
        <div className="skeleton h-4 w-1/3 rounded-md" />
        <div className="flex gap-2 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-12 w-20 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

function useOptions() {
  const settings = useStore((s) => s.settings);
  return useState<DownloadOptions>(() =>
    settings ? defaultOptions(settings) : { kind: "video", maxHeight: 1080, audioFormat: "mp3" },
  );
}

const kindOptions: { value: MediaKind; label: React.ReactNode }[] = [
  { value: "video", label: <><Film className="size-3.5" /> Video</> },
  { value: "audio", label: <><Music className="size-3.5" /> Audio</> },
];

function VideoCard({ info }: { info: Extract<MediaInfo, { type: "video" }> }) {
  const { clearPreview, fetchInfo, toast } = useStore();
  const [opts, setOpts] = useOptions();
  const [busy, setBusy] = useState(false);

  // Only offer heights the video actually has; keep the user's default if present.
  const heights = useMemo(() => info.qualities.map((q) => q.height), [info]);
  useEffect(() => {
    if (opts.maxHeight && heights.length && !heights.includes(opts.maxHeight)) {
      const fallback = heights.find((h) => h <= (opts.maxHeight ?? 0)) ?? heights[heights.length - 1];
      setOpts((o) => ({ ...o, maxHeight: fallback }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heights]);

  const download = async () => {
    setBusy(true);
    try {
      await api.addDownloads(
        [{ url: info.url, title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader }],
        opts,
      );
      toast({ kind: "success", text: "Added to queue" });
      clearPreview();
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const best = info.qualities[0];

  return (
    <div className={clsx(card, "p-4 flex gap-5")}>
      <Thumb src={info.thumbnail} className="w-72 aspect-video rounded-xl">
        {info.duration != null && (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[11px] font-medium">
            {formatDuration(info.duration)}
          </span>
        )}
      </Thumb>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-[17px] font-semibold leading-snug line-clamp-2 selectable">{info.title}</h2>
          <IconButton title="Close" onClick={clearPreview}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-4 text-[13px] text-muted mt-1.5">
          {info.uploader && (
            <span className="inline-flex items-center gap-1.5"><User className="size-3.5" />{info.uploader}</span>
          )}
          {info.viewCount != null && (
            <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" />{formatCount(info.viewCount)} views</span>
          )}
          {info.extractor && info.extractor !== "Youtube" && (
            <span className="px-1.5 py-0.5 rounded-md bg-panel-2 border border-line text-[11px]">{info.extractor}</span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Segmented layoutId="video-kind" value={opts.kind} options={kindOptions} onChange={(kind) => setOpts({ ...opts, kind })} />
          {info.hasPlaylist && (
            <Button variant="ghost" size="sm" onClick={() => fetchInfo(useStore.getState().preview.url, false)}>
              <ListVideo className="size-4" /> Load full playlist
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {opts.kind === "video" ? (
            info.qualities.length ? (
              info.qualities.map((q) => (
                <Chip
                  key={q.height}
                  active={opts.maxHeight === q.height || (opts.maxHeight == null && q === best)}
                  onClick={() => setOpts({ ...opts, maxHeight: q.height })}
                  sub={q.approxSize ? `~${formatBytes(q.approxSize + (info.audioSize ?? 0))}` : undefined}
                >
                  {qualityLabel(q.height)}
                  {q.fps && q.fps > 30 ? Math.round(q.fps) : ""}
                </Chip>
              ))
            ) : (
              <Chip active onClick={() => {}}>Best available</Chip>
            )
          ) : (
            AUDIO_FORMATS.map((f) => (
              <Chip
                key={f}
                active={opts.audioFormat === f}
                onClick={() => setOpts({ ...opts, audioFormat: f })}
                sub={f === "mp3" || f === "m4a" ? (info.audioSize ? `~${formatBytes(info.audioSize)}` : "Best quality") : f === "opus" ? "Smallest" : "Lossless"}
              >
                {f.toUpperCase()}
              </Chip>
            ))
          )}
        </div>

        <div className="mt-auto pt-4 flex justify-end">
          <Button variant="primary" size="lg" onClick={download} disabled={busy}>
            <Download className="size-4" />
            Download {opts.kind === "audio" ? opts.audioFormat.toUpperCase() : qualityLabel(opts.maxHeight)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlaylistCard({ info }: { info: Extract<MediaInfo, { type: "playlist" }> }) {
  const { clearPreview, toast } = useStore();
  const [opts, setOpts] = useOptions();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(info.entries.map((e) => e.url)));
  const [query, setQuery] = useState("");
  const [numbered, setNumbered] = useState(true);
  const [busy, setBusy] = useState(false);

  const indexed = useMemo(() => info.entries.map((e, i) => ({ e, i })), [info]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? indexed.filter(({ e }) => e.title.toLowerCase().includes(q)) : indexed;
  }, [indexed, query]);

  const totalDuration = useMemo(
    () => info.entries.filter((e) => selected.has(e.url)).reduce((a, e) => a + (e.duration ?? 0), 0),
    [info, selected],
  );

  const allVisibleSelected = visible.length > 0 && visible.every(({ e }) => selected.has(e.url));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const { e } of visible) allVisibleSelected ? next.delete(e.url) : next.add(e.url);
    setSelected(next);
  };
  const toggle = (e: PlaylistEntry) => {
    const next = new Set(selected);
    next.has(e.url) ? next.delete(e.url) : next.add(e.url);
    setSelected(next);
  };

  const pad = String(info.entries.length).length;
  const download = async () => {
    const items = indexed
      .filter(({ e }) => selected.has(e.url))
      .map(({ e, i }) => ({
        url: e.url,
        title: e.title,
        thumbnail: e.thumbnail,
        duration: e.duration,
        uploader: e.uploader,
        playlistTitle: info.title,
        filenamePrefix: numbered ? `${String(i + 1).padStart(Math.max(2, pad), "0")} - ` : null,
      }));
    if (!items.length) return;
    setBusy(true);
    try {
      await api.addDownloads(items, opts);
      toast({ kind: "success", text: `Added ${items.length} videos from “${info.title}”` });
      clearPreview();
    } catch (e) {
      toast({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const listRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  return (
    <div className={clsx(card, "flex flex-col overflow-hidden")}>
      <div className="p-4 flex gap-4 items-start border-b border-line">
        <Thumb src={info.thumbnail ?? info.entries[0]?.thumbnail ?? null} className="w-36 aspect-video rounded-lg">
          <div className="absolute inset-y-0 right-0 w-14 bg-black/70 grid place-items-center text-white">
            <div className="text-center">
              <ListVideo className="size-4 mx-auto" />
              <div className="text-[11px] font-semibold mt-0.5">{info.entries.length}</div>
            </div>
          </div>
        </Thumb>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Playlist</div>
          <h2 className="text-[17px] font-semibold leading-snug truncate selectable">{info.title}</h2>
          <div className="text-[13px] text-muted mt-0.5">
            {info.uploader && <>{info.uploader} · </>}
            {info.entries.length} videos
          </div>
        </div>
        <IconButton title="Close" onClick={clearPreview}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-line bg-panel-2/50">
        <Segmented layoutId="pl-kind" value={opts.kind} options={kindOptions} onChange={(kind) => setOpts({ ...opts, kind })} />
        {opts.kind === "video" ? (
          <Select
            value={String(opts.maxHeight ?? "best")}
            onChange={(v) => setOpts({ ...opts, maxHeight: v === "best" ? null : Number(v) })}
            options={HEIGHTS.map((h) => ({ value: String(h ?? "best"), label: h ? `Up to ${qualityLabel(h)}` : "Best quality" }))}
          />
        ) : (
          <Select
            value={opts.audioFormat}
            onChange={(audioFormat) => setOpts({ ...opts, audioFormat })}
            options={AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
          />
        )}
        <label className="inline-flex items-center gap-2 text-[13px] text-muted">
          <Switch checked={numbered} onChange={setNumbered} /> Number files
        </label>
        <div className="flex-1" />
        <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-panel border border-line w-56 focus-within:border-accent">
          <Search className="size-3.5 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter videos"
            className="bg-transparent outline-none text-[13px] flex-1 min-w-0"
          />
        </div>
      </div>

      <div className="px-4 py-2 flex items-center gap-3 text-[13px] border-b border-line">
        <Checkbox checked={allVisibleSelected} onClick={toggleAll} />
        <span className="text-muted">
          {selected.size} of {info.entries.length} selected
          {totalDuration > 0 && <> · {formatDuration(totalDuration)}</>}
        </span>
      </div>

      <div ref={listRef} className="h-[300px] overflow-y-auto">
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((row) => {
            const { e, i } = visible[row.index];
            const on = selected.has(e.url);
            return (
              <div
                key={e.url}
                onClick={() => toggle(e)}
                className={clsx(
                  "absolute inset-x-0 flex items-center gap-3 px-4 transition-colors",
                  on ? "hover:bg-hover" : "opacity-55 hover:opacity-80",
                )}
                style={{ top: row.start, height: row.size }}
              >
                <Checkbox checked={on} />
                <span className="w-8 text-right text-[12px] tabular-nums text-muted">{i + 1}</span>
                <Thumb src={e.thumbnail} className="w-[72px] aspect-video rounded-md" />
                <span className="flex-1 min-w-0 truncate text-[13px]">{e.title}</span>
                <span className="text-[12px] tabular-nums text-muted">{formatDuration(e.duration)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-4 flex justify-end border-t border-line">
        <Button variant="primary" size="lg" onClick={download} disabled={busy || selected.size === 0}>
          <Download className="size-4" /> Download {selected.size} {selected.size === 1 ? "video" : "videos"}
        </Button>
      </div>
    </div>
  );
}

function Checkbox({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick();
        }
      }}
      className={clsx(
        "size-[18px] rounded-md grid place-items-center border transition-colors shrink-0 cursor-default",
        checked ? "gradient-accent border-transparent text-white" : "border-line bg-panel",
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}
