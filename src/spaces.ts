/**
 * Space registry. A Spectrum `Space` is what you `send()` into. We keep live Space objects in
 * memory (populated from inbound messages) so reminders can message people proactively, and
 * rehydrate from the stored space id after a restart.
 */
import type { Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { getSpaceRow } from "./db";
import { logger } from "./logger";

const log = logger("spaces");
const live = new Map<string, Space>();

export function registerSpace(key: string, space: Space) {
  live.set(key, space);
}

export async function resolveSpace(key: string, app: unknown): Promise<Space | null> {
  const cached = live.get(key);
  if (cached) return cached;
  const row = getSpaceRow(key);
  if (!row) return null;
  try {
    if (row.platform === "imessage") {
      const space = (await imessage(app as any).space.get(row.space_id)) as Space;
      live.set(key, space);
      return space;
    }
  } catch (e) {
    log.warn(`couldn't rehydrate space ${key}`, e);
  }
  return null;
}
