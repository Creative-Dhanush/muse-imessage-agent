/** Tiny leveled logger. Useful, not spammy: `info` shows one line per turn. */
import { config } from "./config";

const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof order;

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  if (order[level] < order[config.logLevel]) return;
  const ts = new Date().toISOString().slice(11, 19);
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra instanceof Error) fn(line, extra.stack ?? extra.message);
  else if (extra !== undefined) fn(line, extra);
  else fn(line);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => emit("debug", scope, m, e),
    info: (m: string, e?: unknown) => emit("info", scope, m, e),
    warn: (m: string, e?: unknown) => emit("warn", scope, m, e),
    error: (m: string, e?: unknown) => emit("error", scope, m, e),
  };
}

/** Mask a phone number / email so logs don't leak PII: +15551234567 -> +1555***4567 */
export function mask(id: string | undefined): string {
  if (!id) return "unknown";
  if (id.includes("@")) {
    const [u, d] = id.split("@");
    return `${u!.slice(0, 2)}***@${d}`;
  }
  return id.length <= 6 ? "***" : `${id.slice(0, 4)}***${id.slice(-4)}`;
}
