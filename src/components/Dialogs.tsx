import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, Gift, Sparkles } from "lucide-react";
import { useT } from "../i18n";
import { installUpdate, useUpdates } from "../lib/updates";
import { Button } from "./ui";

/** Accessible modal: focus moves in, Escape closes, focus is trapped. */
function Modal({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("button, a, input, select, [tabindex]:not([tabindex='-1'])");
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            className="w-full max-w-md rounded-2xl bg-panel border border-line shadow-[0_30px_80px_-20px_#000a] p-6"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Notes({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed max-h-60 overflow-y-auto selectable">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-accent">•</span>
          <span>{l.replace(/^[-*•]\s*/, "").replace(/\*\*/g, "")}</span>
        </li>
      ))}
    </ul>
  );
}

export function UpdateDialogs() {
  const t = useT();
  const { available, progress, whatsNew, dismiss, closeWhatsNew } = useUpdates();

  return (
    <>
      <Modal open={!!available} onClose={() => progress == null && dismiss()} labelledBy="update-title">
        {available && (
          <>
            <div className="size-11 rounded-xl gradient-accent grid place-items-center">
              <Gift className="size-5 text-white" />
            </div>
            <h2 id="update-title" className="mt-4 text-[18px] font-semibold">
              {t("update.available", { v: available.version })}
            </h2>
            <p className="mt-1 text-[13px] text-muted">{t("update.availableHint", { current: available.current })}</p>
            {available.notes && <Notes text={available.notes} />}
            {progress != null && (
              <div className="mt-4">
                <div className="h-1.5 rounded-full bg-panel-2 overflow-hidden">
                  <div className="h-full gradient-accent transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1.5 text-[12px] text-muted tabular-nums">{t("update.downloading", { p: progress })}</div>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={dismiss} disabled={progress != null}>
                {t("update.later")}
              </Button>
              <Button variant="primary" onClick={installUpdate} disabled={progress != null}>
                <Download className="size-4" /> {t("update.install")}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!whatsNew} onClose={closeWhatsNew} labelledBy="whatsnew-title">
        {whatsNew && (
          <>
            <div className="size-11 rounded-xl gradient-accent grid place-items-center">
              <Sparkles className="size-5 text-white" />
            </div>
            <h2 id="whatsnew-title" className="mt-4 text-[18px] font-semibold">
              {t("whatsNew.title", { v: whatsNew.version })}
            </h2>
            <Notes text={whatsNew.notes || t("whatsNew.fallback")} />
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={closeWhatsNew}>
                {t("whatsNew.close")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
