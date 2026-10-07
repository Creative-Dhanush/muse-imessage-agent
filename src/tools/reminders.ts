import { tool } from "ai";
import { z } from "zod";
import { getTimezone, reminders } from "../db";
import { formatWhen, parseWhen } from "../timeutil";
import type { ToolContext } from "./context";

export function reminderTools(ctx: ToolContext) {
  return {
    set_reminder: tool({
      description:
        "Schedule a reminder that Muse will text back at the right time. Supports one-off and repeating reminders. " +
        "Use `agentTask` for *smart* scheduled actions (e.g. a morning briefing): at the due time Muse will actually run that task " +
        "(search the web, check weather, read the user's tasks...) and text the result, instead of just echoing `message`. " +
        "Provide exactly one of `when` or `inMinutes`.",
      inputSchema: z.object({
        message: z.string().describe("What to remind the user about, written as the text Muse will send, e.g. 'Call mom'."),
        when: z
          .string()
          .optional()
          .describe("ISO-8601 local date-time in the USER's timezone, e.g. '2026-10-07T09:00:00'. Do not include an offset unless the user gave one."),
        inMinutes: z.number().positive().max(60 * 24 * 365).optional().describe("Relative delay in minutes, e.g. 20 for 'in 20 minutes'."),
        repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]).default("none"),
        agentTask: z
          .string()
          .optional()
          .describe("Optional instruction for Muse to execute at due time, e.g. 'Give me a morning briefing: weather, my open tasks, and top tech headlines.'"),
      }),
      execute: async ({ message, when, inMinutes, repeat, agentTask }) => {
        const tz = getTimezone(ctx.userKey);
        let dueAt: number | null = null;
        if (inMinutes !== undefined) dueAt = Date.now() + Math.round(inMinutes * 60_000);
        else if (when) dueAt = parseWhen(when, tz);
        if (dueAt === null) return { error: "Couldn't understand the time. Provide `when` as ISO-8601 or `inMinutes`." };
        if (dueAt < Date.now() - 60_000) return { error: "That time is in the past. Ask the user what they meant, or pick the next occurrence." };

        const r = reminders.add({
          user_id: ctx.userKey,
          space_key: ctx.spaceKey,
          text: message,
          agent_task: agentTask ?? null,
          due_at: Math.max(dueAt, Date.now() + 1000),
          repeat,
          tz,
        });
        return {
          ok: true,
          id: r.id,
          firesAt: formatWhen(r.due_at, tz),
          repeat,
          smartTask: Boolean(agentTask),
        };
      },
    }),

    list_reminders: tool({
      description: "List the user's upcoming reminders and scheduled tasks.",
      inputSchema: z.object({}),
      execute: async () => {
        const tz = getTimezone(ctx.userKey);
        const rows = reminders.listForUser(ctx.userKey);
        return rows.map((r) => ({
          id: r.id,
          message: r.text,
          when: formatWhen(r.due_at, tz),
          repeat: r.repeat,
          smartTask: Boolean(r.agent_task),
        }));
      },
    }),

    cancel_reminder: tool({
      description: "Cancel a reminder by its id (use list_reminders first if you don't know the id).",
      inputSchema: z.object({ id: z.number().int() }),
      execute: async ({ id }) => ({ ok: reminders.cancel(ctx.userKey, id) }),
    }),
  };
}
