import { tool } from "ai";
import { DateTime } from "luxon";
import { z } from "zod";
import { getTimezone, setTimezone } from "../db";
import { isValidZone } from "../timeutil";
import type { ToolContext } from "./context";

export function timeTools(ctx: ToolContext) {
  return {
    get_current_time: tool({
      description:
        "Get the current date and time. Defaults to the user's timezone; pass an IANA timezone (e.g. 'Asia/Tokyo') to get the time somewhere else.",
      inputSchema: z.object({
        timezone: z.string().optional().describe("IANA timezone like 'Europe/London'. Omit for the user's own."),
      }),
      execute: async ({ timezone }) => {
        const tz = timezone ?? getTimezone(ctx.userKey);
        if (!isValidZone(tz)) return { error: `Unknown timezone '${tz}'. Use an IANA name like 'America/New_York'.` };
        const dt = DateTime.now().setZone(tz);
        return {
          timezone: tz,
          iso: dt.toISO(),
          readable: dt.toFormat("cccc, LLLL d, yyyy 'at' h:mm a"),
          utcOffset: dt.toFormat("ZZ"),
        };
      },
    }),

    set_user_timezone: tool({
      description:
        "Save the user's home timezone so reminders and times are right. Call this when the user tells you where they live / their timezone, or after you infer it with confidence.",
      inputSchema: z.object({ timezone: z.string().describe("IANA timezone, e.g. 'America/Chicago'") }),
      execute: async ({ timezone }) => {
        if (!isValidZone(timezone)) return { error: `'${timezone}' isn't a valid IANA timezone.` };
        setTimezone(ctx.userKey, timezone);
        return { ok: true, timezone, nowThere: DateTime.now().setZone(timezone).toFormat("cccc h:mm a") };
      },
    }),
  };
}
