import { useEffect, useRef, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { ClipboardPaste, Link2, Loader2, Search, X, Zap } from "lucide-react";
import clsx from "clsx";
import { useStore } from "../store";
import { api, errorText } from "../lib/api";
import { extractUrls } from "../lib/format";
import type { DownloadOptions, Settings } from "../lib/types";
import { Button, IconButton } from "./ui";
import { useT } from "../i18n";
import { MOD } from "../lib/platform";

export const defaultOptions = (s: Settings): DownloadOptions => ({
  kind: s.defaultKind,
  maxHeight: s.defaultMaxHeight,
  audioFormat: s.audioFormat,
});

/** watch?v=…&list=… → treat as a single video first (user can expand). */
const isPlaylistOnly = (url: string) => /[?&]list=/.test(url) && !/[?&]v=/.test(url);

export function useSubmitUrls() {
  const { fetchInfo, toast, settings } = useStore();
  const t = useT();
  return async (text: string, quick = false) => {
    const urls = extractUrls(text);
    if (urls.length === 0) {
      toast({ kind: "error", text: t("url.noLink") });
      return false;
    }
    if (urls.length > 1 || quick) {
      if (!settings) return false;
      try {
        await api.addDownloads(
          urls.map((url) => ({ url })),
          defaultOptions(settings),
        );
        toast({
          kind: "success",
          text: urls.length > 1 ? t("url.addedMany", { n: urls.length }) : t("url.addedOne"),
        });
        return true;
      } catch (e) {
        toast({ kind: "error", text: errorText(e) });
        return false;
      }
    }
    const url = urls[0];
    fetchInfo(url, !isPlaylistOnly(url));
    return true;
  };
}

export function UrlBar() {
  const t = useT();
  const focusUrl = useStore((s) => s.focusUrl);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { preview, clearPreview } = useStore();
  const submit = useSubmitUrls();

  // Keep the field in sync when a fetch is started elsewhere (clipboard toast).
  useEffect(() => {
    if (preview.url) setText(preview.url);
  }, [preview.url]);

  // File → New Download (⌘N) and similar requests focus the field.
  useEffect(() => {
    if (focusUrl) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusUrl]);

  // ⌘L / Ctrl+L focuses the link field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paste = async () => {
    try {
      const t = (await readText()) ?? "";
      setText(t.trim());
      if (extractUrls(t).length) submit(t);
    } catch {
      inputRef.current?.focus();
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const t = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
        if (t) {
          setText(t.trim());
          submit(t);
        }
      }}
      className={clsx(
        "flex items-center gap-2 p-2 pl-4 rounded-2xl bg-panel border transition-all shadow-[var(--shadow)]",
        dragOver ? "border-accent ring-4 ring-accent-soft" : "border-line focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft",
      )}
    >
      <Link2 className="size-5 text-muted shrink-0" />
      <input
        ref={inputRef}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (extractUrls(t).length) {
            e.preventDefault();
            setText(t.trim());
            submit(t);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(text, e.metaKey || e.ctrlKey);
          if (e.key === "Escape") {
            setText("");
            clearPreview();
          }
        }}
        placeholder={t("url.placeholder")}
        aria-label={t("url.placeholder")}
        spellCheck={false}
        className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted min-w-0"
      />
      {text && (
        <IconButton
          title={t("url.clear")}
          onClick={() => {
            setText("");
            clearPreview();
            inputRef.current?.focus();
          }}
        >
          <X className="size-4" />
        </IconButton>
      )}
      <Button variant="ghost" size="md" onClick={paste}>
        <ClipboardPaste className="size-4" /> {t("url.paste")}
      </Button>
      <Button
        variant="secondary"
        onClick={() => submit(text, true)}
        disabled={!text.trim()}
        title={t("url.quickTitle", { key: `${MOD}↵` })}
      >
        <Zap className="size-4" /> {t("url.quick")}
      </Button>
      <Button variant="primary" onClick={() => submit(text)} disabled={!text.trim() || preview.loading}>
        {preview.loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        {t("url.fetch")}
      </Button>
    </div>
  );
}
