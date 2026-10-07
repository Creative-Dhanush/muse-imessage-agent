import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function reactTools(ctx: ToolContext): ToolSet {
  if (!ctx.react) return {};
  const react = ctx.react;
  return {
    react_to_message: tool({
      description:
        "Send an iMessage tapback on the user's message. Use it like a human would: ❤️ love for sweet/exciting news, 👍 like to acknowledge a simple instruction or confirm something done, " +
        "😂 laugh for jokes, ‼️ emphasize for urgent/important stuff, ❓ question when you're confused. " +
        "Often a tapback ALONE (reply with exactly NO_REPLY) is the perfect response, e.g. to 'thanks!' or 'ok'. Don't overuse it.",
      inputSchema: z.object({ reaction: z.enum(["love", "like", "dislike", "laugh", "emphasize", "question"]) }),
      execute: async ({ reaction }) => ({ ok: await react(reaction) }),
    }),
  };
}
