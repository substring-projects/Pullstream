import type { Key } from "../i18n";

export type ErrorFix = "cookies" | "update" | "retry" | "settings";

export interface ExplainedError {
  title: Key;
  hint: Key;
  fix: ErrorFix | null;
  fixLabel: Key | null;
}

/**
 * Turn raw yt-dlp error text into a plain-language explanation and,
 * where possible, a one-click fix. Patterns cover yt-dlp's common messages.
 */
export function explainError(raw: string | null | undefined): ExplainedError {
  const e = (raw ?? "").toLowerCase();
  const has = (...parts: string[]) => parts.some((p) => e.includes(p));

  if (has("not a bot", "confirm you’re not a bot", "confirm you're not a bot"))
    return { title: "err.bot.title", hint: "err.bot.hint", fix: "cookies", fixLabel: "err.signIn.action" };
  if (has("sign in to confirm your age", "age-restricted", "inappropriate for some users", "sign in", "login required", "cookies"))
    return { title: "err.signIn.title", hint: "err.signIn.hint", fix: "cookies", fixLabel: "err.signIn.action" };
  if (has("members-only", "join this channel"))
    return { title: "err.members.title", hint: "err.members.hint", fix: "cookies", fixLabel: "err.signIn.action" };
  if (has("private video"))
    return { title: "err.private.title", hint: "err.private.hint", fix: null, fixLabel: null };
  if (has("premieres in", "live event will begin", "this live event", "is not currently live"))
    return { title: "err.live.title", hint: "err.live.hint", fix: "retry", fixLabel: "action.retry" };
  if (has("video unavailable", "has been removed", "not available in your country", "geo restrict", "account associated with this video has been terminated"))
    return { title: "err.unavailable.title", hint: "err.unavailable.hint", fix: null, fixLabel: null };
  if (has("requested format is not available", "no video formats found"))
    return { title: "err.format.title", hint: "err.format.hint", fix: "retry", fixLabel: "action.retry" };
  if (has("no space left", "disk full", "not enough space"))
    return { title: "err.disk.title", hint: "err.disk.hint", fix: "settings", fixLabel: "banner.openSettings" };
  if (has("unsupported url"))
    return { title: "err.unsupported.title", hint: "err.unsupported.hint", fix: null, fixLabel: null };
  if (has("http error 403", "forbidden", "signature", "nsig", "unable to extract", "player response"))
    return { title: "err.forbidden.title", hint: "err.forbidden.hint", fix: "update", fixLabel: "err.forbidden.action" };
  if (has("timed out", "connection", "network is unreachable", "getaddrinfo", "name resolution", "temporary failure", "ssl", "read timed out"))
    return { title: "err.network.title", hint: "err.network.hint", fix: "retry", fixLabel: "action.retry" };
  return { title: "err.generic.title", hint: "err.network.hint", fix: "retry", fixLabel: "action.retry" };
}

/** Pick a browser to read cookies from: the platform's default browser. */
export function defaultCookieBrowser(): string {
  return navigator.userAgent.includes("Mac") ? "safari" : "chrome";
}
