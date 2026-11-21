import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { COMPANY, open } from "../lib/links";

const LAST_UPDATED = "November 21, 2026";

const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <button onClick={() => open(href)} className="text-accent hover:underline underline-offset-2 cursor-default">
    {children}
  </button>
);

const SECTIONS: { title: string; body: ReactNode }[] = [
  {
    title: "1. Accepting these terms",
    body: (
      <p>
        PullStream (“the app”) is made by {COMPANY.name} (“we”, “us”). By installing or using the app you agree to these
        terms. If you don't agree, please don't use the app.
      </p>
    ),
  },
  {
    title: "2. An unofficial tool",
    body: (
      <p>
        PullStream is an independent app. It is not affiliated with, endorsed by or sponsored by YouTube, Google or any
        other website it can download from. All trademarks belong to their owners.
      </p>
    ),
  },
  {
    title: "3. What you may download",
    body: (
      <>
        <p>You are responsible for what you download and how you use it. Only download content that:</p>
        <ul>
          <li>you created or own;</li>
          <li>is published under a licence that allows downloading, such as Creative Commons or the public domain; or</li>
          <li>you have the rights holder's permission to download.</li>
        </ul>
        <p>
          Many websites, including YouTube, restrict downloading in their own terms of service. You must follow the
          terms of every site you use, and the copyright laws that apply to you. Don't use PullStream to infringe
          copyright, to get around paywalls or access controls, or to redistribute content you don't have rights to.
        </p>
      </>
    ),
  },
  {
    title: "4. YouTube downloads are at your own risk",
    body: (
      <>
        <p>
          YouTube does not officially support downloading its videos. Its terms of service allow downloading only
          through features YouTube provides itself, such as offline viewing in the YouTube app. PullStream is not one of
          those features.
        </p>
        <p>
          If you use PullStream to download YouTube videos, you do so <strong>entirely at your own risk</strong>. You
          alone are responsible for any consequences, including action taken by YouTube or Google against your
          account, and any claim by a copyright owner.
        </p>
        <p>
          {COMPANY.name} does not encourage downloading YouTube videos against YouTube's terms and is not responsible
          or liable for any loss, damage, account action or legal claim that results from it.
        </p>
      </>
    ),
  },
  {
    title: "5. Third-party tools",
    body: (
      <p>
        PullStream works with free, open-source tools: yt-dlp, FFmpeg and Deno. With your permission, the app downloads
        them from their official sources during setup. They are separate software under their own licences, and we
        don't control them. Websites change often, so a site can stop working until those tools are updated.
      </p>
    ),
  },
  {
    title: "6. Your privacy",
    body: (
      <>
        <p>
          PullStream runs entirely on your computer. It has no account, no ads and no analytics, and we don't collect
          or receive your download history, links or files.
        </p>
        <p>The app only connects to the internet to:</p>
        <ul>
          <li>load and download the links you give it;</li>
          <li>download and update its tools from their official sources (GitHub, martin-riedl.de or gyan.dev).</li>
        </ul>
        <p>
          If you turn on “Use browser cookies” in Settings, the app reads that browser's cookies on your computer so
          downloads can use your logged-in sessions. The cookies are passed only to yt-dlp on your computer and are
          never sent to us.
        </p>
      </>
    ),
  },
  {
    title: "7. No warranty",
    body: (
      <p>
        The app is provided “as is” and “as available”, without warranties of any kind, express or implied, including
        fitness for a particular purpose. We don't guarantee that it will work with any particular website, or that
        it will be error-free or uninterrupted.
      </p>
    ),
  },
  {
    title: "8. Limitation of liability",
    body: (
      <p>
        To the fullest extent the law allows, {COMPANY.name} is not liable for any indirect, incidental or
        consequential damages, or for any loss of data, files or profits, arising from your use of the app. You are
        solely responsible for any claim that results from content you download.
      </p>
    ),
  },
  {
    title: "9. Changes to these terms",
    body: (
      <p>
        We may update these terms from time to time. The date at the top shows the latest version. Continuing to use
        the app after an update means you accept the new terms.
      </p>
    ),
  },
  {
    title: "10. Governing law",
    body: (
      <p>
        These terms are governed by the laws of India. Any dispute will be handled by the courts in Lucknow, Uttar
        Pradesh.
      </p>
    ),
  },
  {
    title: "11. Contact",
    body: (
      <p>
        Questions about these terms? Email <span className="selectable font-medium">{COMPANY.email}</span> or use the{" "}
        <Link href={COMPANY.contact}>contact page</Link> on our website.
      </p>
    ),
  },
];

export function TermsView() {
  return (
    <div className="flex-1 overflow-y-auto -mx-2 px-2">
      <article className="max-w-3xl pb-10">
        <h1 className="text-2xl font-bold">Terms & Conditions</h1>
        <div className="mt-1 text-[13px] text-muted">Last updated {LAST_UPDATED}</div>

        <div className="mt-5 flex gap-3 p-4 rounded-2xl border border-warn/40 bg-warn/10">
          <AlertTriangle className="size-5 text-warn shrink-0 mt-0.5" />
          <p className="text-[13.5px] leading-relaxed">
            <strong>Downloading YouTube videos is not officially supported by YouTube.</strong> If you download YouTube
            videos with PullStream, you do so at your own risk. {COMPANY.name} is not responsible for any consequences.
            See section 4.
          </p>
        </div>

        <div className="mt-6 rounded-2xl bg-panel border border-line shadow-[var(--shadow)] p-6 space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-[15px] font-semibold">{s.title}</h2>
              <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-fg/85 selectable [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
