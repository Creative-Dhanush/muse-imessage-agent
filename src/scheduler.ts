/**
 * Reminder scheduler. Polls SQLite every few seconds; when a reminder is due it either
 *   (a) texts the reminder verbatim, or
 *   (b) for "smart" reminders (agentTask), runs the agent with the task and texts the result —
 *       this is how daily briefings work.
 * Repeating reminders are rescheduled; one-offs are deleted after a successful send.
 */
import { generateReply } from "./agent";
import { appendTurn, reminders, type Reminder } from "./db";
import { isNoReply, sleep, toBubbles, bubbleDelay } from "./format";
import { logger } from "./logger";
import { resolveSpace } from "./spaces";
import { nextOccurrence } from "./timeutil";

const log = logger("scheduler");
let busy = false;

export function startScheduler(app: unknown): () => void {
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const r of reminders.due()) await fire(app, r);
    } catch (e) {
      log.error("scheduler tick failed", e);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 5_000);
  void tick();
  log.info("reminder scheduler started");
  return () => clearInterval(timer);
}

async function fire(app: unknown, r: Reminder) {
  try {
    const space = await resolveSpace(r.space_key, app);
    if (!space) throw new Error("space unavailable");

    const lateMin = Math.round((Date.now() - r.due_at) / 60_000);
    let text: string;
    if (r.agent_task) {
      text = await generateReply({
        platform: r.space_key.split(":")[0]!,
        text: `[Scheduled task] ${r.agent_task}`,
        ctx: { userKey: r.user_id, spaceKey: r.space_key, isGroup: false, scheduled: true },
      });
    } else {
      text = `⏰ ${r.text}${lateMin >= 10 ? `\n\n(sorry, ${lateMin >= 120 ? `${Math.round(lateMin / 60)}h` : `${lateMin}m`} late, I was offline)` : ""}`;
    }

    if (!isNoReply(text) && text.trim()) {
      const bubbles = toBubbles(text);
      for (let i = 0; i < bubbles.length; i++) {
        if (i > 0) await sleep(bubbleDelay(bubbles[i]!));
        await space.send(bubbles[i]!);
      }
      appendTurn(r.space_key, "assistant", text);
    }
    log.info(`fired reminder #${r.id}${r.agent_task ? " (smart)" : ""}`);

    const next = nextOccurrence(r.due_at, r.repeat, r.tz);
    if (next) reminders.reschedule(r.id, next);
    else reminders.remove(r.id);
  } catch (e) {
    log.warn(`reminder #${r.id} failed (attempt ${r.attempts + 1}/5)`, e);
    reminders.bumpAttempts(r.id);
  }
}
