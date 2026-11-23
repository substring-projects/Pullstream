export const isMac = navigator.userAgent.includes("Mac");
export const isWindows = navigator.userAgent.includes("Windows");

/** "⌘" on macOS, "Ctrl" elsewhere, for shortcut labels. */
export const MOD = isMac ? "⌘" : "Ctrl+";

/** ⌘ on macOS, Ctrl elsewhere. */
export const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

/** True when typing in a field, so global shortcuts should stand aside. */
export const isTyping = (e: Event) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};
