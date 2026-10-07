/** Outbound formatting helpers: iMessage doesn't render markdown, and long walls of text feel robotic. */

export const NO_REPLY = "NO_REPLY";

/** Strip markdown the model sometimes emits despite instructions. */
export function toPlainText(s: string): string {
  return s
    .replace(/```[a-z]*\n?([\s\S]*?)```/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split into natural chat bubbles on blank lines; cap the count so we never spam. */
export function toBubbles(s: string, max = 3): string[] {
  const parts = toPlainText(s).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= max) return parts;
  const head = parts.slice(0, max - 1);
  head.push(parts.slice(max - 1).join("\n\n"));
  return head;
}

/** Typing-speed-ish pause between bubbles so multi-part replies feel human (capped at 1.2s). */
export const bubbleDelay = (text: string) => Math.min(1200, 250 + text.length * 8);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isNoReply(s: string): boolean {
  return s.trim().replace(/[^A-Za-z_]/g, "").toUpperCase() === NO_REPLY;
}
