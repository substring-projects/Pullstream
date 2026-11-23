import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowUpRight, Download, Globe, Layers, Mail, MapPin, Zap } from "lucide-react";
import { COMPANY, THIRD_PARTY, open } from "../lib/links";
import { useStore } from "../store";
import { Button } from "./ui";
import { useT } from "../i18n";
import logoFull from "../assets/logo-full.jpg";

export function AboutView() {
  const t = useT();
  const [version, setVersion] = useState("");
  const setView = useStore((s) => s.setView);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="flex-1 overflow-y-auto -mx-2 px-2">
      <div className="max-w-3xl pb-8">
        {/* App */}
        <div className="relative overflow-hidden rounded-3xl bg-black shadow-[var(--shadow)]">
          <img
            src={logoFull}
            alt="PullStream: video download"
            draggable={false}
            className="mx-auto h-64 w-auto object-contain"
          />
          <span className="absolute bottom-3 right-4 px-2 py-0.5 rounded-md bg-white/10 backdrop-blur text-white/80 text-[12px] font-medium">
            {t("about.version", { v: version || "—" })}
          </span>
        </div>

        <p className="mt-5 text-[14px] leading-relaxed text-fg/90 max-w-2xl">
          {t("about.description")}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { icon: Zap, title: t("about.f1.title"), text: t("about.f1.text") },
            { icon: Layers, title: t("about.f2.title"), text: t("about.f2.text") },
            { icon: Download, title: t("about.f3.title"), text: t("about.f3.text") },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl bg-panel border border-line p-4 shadow-[var(--shadow)]">
              <f.icon className="size-4 text-accent" />
              <div className="mt-2 text-[13px] font-semibold">{f.title}</div>
              <div className="mt-1 text-[12px] text-muted leading-relaxed">{f.text}</div>
            </div>
          ))}
        </div>

        {/* Creator */}
        <h3 className="mt-8 mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted">{t("about.madeBy")}</h3>
        <div className="rounded-2xl bg-panel border border-line p-5 shadow-[var(--shadow)]">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-xl bg-accent-soft text-accent grid place-items-center text-[18px] font-bold shrink-0">
              S
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-semibold">{COMPANY.name}</div>
              <p className="mt-1 text-[13px] text-muted leading-relaxed">
                {t("about.company", { year: COMPANY.founded })}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{COMPANY.location}</span>
                <span className="inline-flex items-center gap-1.5 selectable"><Mail className="size-3.5" />{COMPANY.email}</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => open(COMPANY.website)}>
                  <Globe className="size-3.5" /> {t("about.website")}
                </Button>
                <Button size="sm" onClick={() => open(COMPANY.contact)}>
                  {t("about.contact")} <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Credits */}
        <h3 className="mt-8 mb-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted">
          {t("about.openSource")}
        </h3>
        <div className="rounded-2xl bg-panel border border-line divide-y divide-line shadow-[var(--shadow)]">
          {THIRD_PARTY.map((t) => (
            <button
              key={t.name}
              onClick={() => open(t.url)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-hover transition-colors first:rounded-t-2xl last:rounded-b-2xl cursor-default"
            >
              <span className="flex-1 text-[14px] font-medium">{t.name}</span>
              <span className="text-[12px] text-muted">{t.license}</span>
              <ArrowUpRight className="size-3.5 text-muted" />
            </button>
          ))}
        </div>
        <p className="mt-2 px-1 text-[12px] text-muted">
          {t("about.openSourceHint")}
        </p>

        <div className="mt-8 flex items-center justify-between px-1 text-[12px] text-muted">
          <span>© {new Date().getFullYear()} {COMPANY.name}. {t("about.rights")}</span>
          <button onClick={() => setView("terms")} className="hover:text-fg hover:underline underline-offset-2 cursor-default">
            {t("nav.terms")}
          </button>
        </div>
      </div>
    </div>
  );
}
