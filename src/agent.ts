/**
 * The brain: wraps the Vercel AI SDK tool loop. Given a user turn, it builds the system prompt
 * (with the user's notes/tasks/time baked in), loads recent history, lets the model call tools
 * for up to MUSE_MAX_STEPS steps, and returns the final text (or a live text stream).
 */
import { generateText, stepCountIs, streamText, type ModelMessage } from "ai";
import { config } from "./config";
import { loadHistory } from "./db";
import { getModel } from "./llm";
import { logger } from "./logger";
import { buildSystemPrompt } from "./persona";
import { buildTools, type ToolContext } from "./tools";

const log = logger("agent");

export interface AgentInput {
  ctx: ToolContext;
  platform: string;
  text: string;
  images?: { data: Uint8Array; mediaType: string }[];
}

function buildCall(input: AgentInput) {
  const { ctx } = input;
  const history: ModelMessage[] = loadHistory(ctx.spaceKey, config.historyTurns).map((t) => ({
    role: t.role,
    content: t.content,
  }));

  const userMessage: ModelMessage = input.images?.length
    ? {
        role: "user",
        content: [
          { type: "text", text: input.text || "(The user sent an image with no caption. Describe what matters and ask what they'd like to do.)" },
          ...input.images.map((img) => ({ type: "image" as const, image: img.data, mediaType: img.mediaType })),
        ],
      }
    : { role: "user", content: input.text };

  return {
    model: getModel(),
    system: buildSystemPrompt({ userKey: ctx.userKey, isGroup: ctx.isGroup, platform: input.platform, scheduled: ctx.scheduled }),
    messages: [...history, userMessage],
    tools: buildTools(ctx),
    stopWhen: stepCountIs(config.maxSteps),
    temperature: 0.6,
    maxRetries: 2,
  };
}

/** Run to completion and return the final reply text. */
export async function generateReply(input: AgentInput): Promise<string> {
  const started = Date.now();
  const result = await generateText({
    ...buildCall(input),
    onStepFinish: (step: any) => {
      for (const call of step.toolCalls ?? []) log.debug(`tool → ${call.toolName}`);
    },
  });
  log.info(`reply in ${Date.now() - started}ms (${result.steps.length} step${result.steps.length === 1 ? "" : "s"})`);
  return result.text;
}

/** Streaming variant: returns an async iterable of text deltas plus a promise of the final text. */
export function streamReplyText(input: AgentInput): { textStream: AsyncIterable<string>; text: Promise<string> } {
  const result = streamText({
    ...buildCall(input),
    onError: ({ error }: { error: unknown }) => log.error("stream error", error as Error),
  });
  return { textStream: result.textStream, text: Promise.resolve(result.text) };
}
