import { tool } from "ai";
import { z } from "zod";
import { getTimezone, notes, tasks } from "../db";
import type { ToolContext } from "./context";
import { DateTime } from "luxon";

export function noteTools(ctx: ToolContext) {
  return {
    save_note: tool({
      description:
        "Save something the user wants remembered long-term ('remember that...', facts, preferences, addresses, codes, ideas). " +
        "Write the note as a clear standalone sentence. Do NOT store secrets like passwords unless the user explicitly insists.",
      inputSchema: z.object({ text: z.string().min(1).max(1000) }),
      execute: async ({ text }) => {
        const n = notes.add(ctx.userKey, text.trim());
        return { ok: true, id: n.id };
      },
    }),

    search_notes: tool({
      description: "Search the user's saved notes. Leave query empty to list the most recent notes.",
      inputSchema: z.object({ query: z.string().optional() }),
      execute: async ({ query }) => {
        const tz = getTimezone(ctx.userKey);
        return notes.search(ctx.userKey, query ?? "").map((n) => ({
          id: n.id,
          text: n.text,
          saved: DateTime.fromMillis(n.created_at, { zone: tz }).toFormat("LLL d"),
        }));
      },
    }),

    delete_note: tool({
      description: "Delete a saved note by id.",
      inputSchema: z.object({ id: z.number().int() }),
      execute: async ({ id }) => ({ ok: notes.remove(ctx.userKey, id) }),
    }),

    add_task: tool({
      description: "Add an item to the user's to-do list.",
      inputSchema: z.object({
        text: z.string().min(1).max(500),
        due: z.string().optional().describe("Optional human due date like 'Friday' or '2026-10-09'."),
      }),
      execute: async ({ text, due }) => {
        const t = tasks.add(ctx.userKey, text.trim(), due);
        return { ok: true, id: t.id, openTasks: tasks.list(ctx.userKey).length };
      },
    }),

    list_tasks: tool({
      description: "List the user's to-do items.",
      inputSchema: z.object({ includeDone: z.boolean().default(false) }),
      execute: async ({ includeDone }) =>
        tasks.list(ctx.userKey, includeDone).map((t) => ({ id: t.id, text: t.text, due: t.due, done: Boolean(t.done) })),
    }),

    complete_task: tool({
      description: "Mark a to-do item as done by id.",
      inputSchema: z.object({ id: z.number().int() }),
      execute: async ({ id }) => {
        const t = tasks.complete(ctx.userKey, id);
        return t ? { ok: true, text: t.text, openTasks: tasks.list(ctx.userKey).length } : { ok: false };
      },
    }),

    delete_task: tool({
      description: "Delete a to-do item by id.",
      inputSchema: z.object({ id: z.number().int() }),
      execute: async ({ id }) => ({ ok: tasks.remove(ctx.userKey, id) }),
    }),
  };
}
