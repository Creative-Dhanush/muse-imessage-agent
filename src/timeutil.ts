/** Timezone-aware date helpers (luxon). All timestamps are stored as UTC epoch ms. */
import { DateTime, IANAZone } from "luxon";

export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export function isValidZone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

/** Parse an ISO-8601 string in the given zone (or its own offset) -> UTC epoch ms. */
export function parseWhen(iso: string, tz: string): number | null {
  const dt = DateTime.fromISO(iso, { zone: tz });
  return dt.isValid ? dt.toMillis() : null;
}

export function formatWhen(utcMs: number, tz: string, now = Date.now()): string {
  const dt = DateTime.fromMillis(utcMs, { zone: tz });
  const today = DateTime.fromMillis(now, { zone: tz }).startOf("day");
  const diffDays = Math.round(dt.startOf("day").diff(today, "days").days);
  const time = dt.toFormat("h:mm a");
  if (diffDays === 0) return `today at ${time}`;
  if (diffDays === 1) return `tomorrow at ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${dt.toFormat("cccc")} at ${time}`;
  return `${dt.toFormat("ccc, LLL d")} at ${time}`;
}

/** Human-readable "now" for the system prompt, e.g. "Tuesday, October 6, 2026, 3:42 PM (Asia/Kolkata, UTC+5:30)". */
export function describeNow(tz: string, nowMs = Date.now()): string {
  const dt = DateTime.fromMillis(nowMs, { zone: tz });
  return `${dt.toFormat("cccc, LLLL d, yyyy, h:mm a")} (${tz}, UTC${dt.toFormat("ZZ")})`;
}

/** Next occurrence strictly after `after` for a repeating reminder. */
export function nextOccurrence(dueMs: number, repeat: Repeat, tz: string, after = Date.now()): number | null {
  if (repeat === "none") return null;
  let dt = DateTime.fromMillis(dueMs, { zone: tz });
  // Advance until in the future (handles the app having been offline for days).
  for (let i = 0; i < 4000; i++) {
    switch (repeat) {
      case "daily":
        dt = dt.plus({ days: 1 });
        break;
      case "weekly":
        dt = dt.plus({ weeks: 1 });
        break;
      case "monthly":
        dt = dt.plus({ months: 1 });
        break;
      case "weekdays":
        do dt = dt.plus({ days: 1 });
        while (dt.weekday > 5);
        break;
    }
    if (dt.toMillis() > after) return dt.toMillis();
  }
  return null;
}
