export function formatBytes(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const formatSpeed = (n: number | null | undefined) =>
  n && n > 0 ? `${formatBytes(n)}/s` : "";

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.round(sec)}s left`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s left`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "";
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

export function qualityLabel(h: number | null): string {
  if (h == null) return "Best";
  if (h >= 4320) return "8K";
  if (h >= 2160) return "4K";
  if (h >= 1440) return "2K";
  return `${h}p`;
}

/** Pull every http(s) link out of arbitrary text. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return Array.from(new Set(found.map((u) => u.replace(/[),.;]+$/, ""))));
}
