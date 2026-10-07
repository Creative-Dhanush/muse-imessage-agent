/**
 * Muse — a personal AI agent that lives in iMessage, powered by Photon Spectrum.
 *
 * Flow of one message:
 *   Spectrum (iMessage) ─▶ filter/allow-list ─▶ debounce bursts ─▶ per-chat queue
 *     ─▶ parse content (text / photo / voice / file) ─▶ slash-commands OR the LLM tool loop
 *     ─▶ typing indicator while thinking ─▶ reply as natural chat bubbles (+ tapbacks)
 */
import { Emoji, Spectrum, text as textContent, type Message, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { generateReply, streamReplyText } from "./agent";
import { bareGreetingOrCommand } from "./router";
import { assertRuntimeConfig, config } from "./config";
import { appendTurn, rememberSpace, touchUser } from "./db";
import { bubbleDelay, isNoReply, NO_REPLY, sleep, toBubbles } from "./format";
import { isConversational, parseInbound } from "./inbound";
import { logger, mask } from "./logger";
import { WELCOME } from "./persona";
import { startScheduler } from "./scheduler";
import { registerSpace } from "./spaces";
import type { ToolContext } from "./tools";

assertRuntimeConfig();
const log = logger("muse");

// --------------------------------------------------------------------------------------------
// 1. Connect to Photon Spectrum
// --------------------------------------------------------------------------------------------
// `imessage.config()` uses the cloud provider: Spectrum discovers your project's iMessage line(s)
// from projectId/projectSecret and renews tokens automatically.
// In MUSE_TERMINAL=1 mode we swap in the terminal provider so you can develop with zero setup;
// the exact same message loop below runs unchanged — that's the point of Spectrum.
const app = await Spectrum({
  ...(config.terminal ? {} : { projectId: config.spectrum.projectId!, projectSecret: config.spectrum.projectSecret! }),
  providers: [config.terminal ? terminal.config() : imessage.config()],
  options: { logLevel: config.logLevel === "debug" ? "debug" : "info" },
} as any);

log.info(`${config.name} is online ✨ (${config.terminal ? "terminal" : "iMessage"} • ${config.llm.provider}:${config.llm.model})`);
const stopScheduler = startScheduler(app);

// --------------------------------------------------------------------------------------------
// 2. Helpers
// --------------------------------------------------------------------------------------------
const nameRe = new RegExp(`\\b${config.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

function isGroupSpace(space: Space, message: Message): boolean {
  if (message.platform !== "imessage") return false;
  try {
    return (imessage(space as any) as any).type === "group";
  } catch {
    return false;
  }
}

/** Send text as human-feeling bubbles. In groups the first bubble is a threaded reply. */
async function sendBubbles(space: Space, message: Message | undefined, bubbles: string[], threaded: boolean) {
  for (let i = 0; i < bubbles.length; i++) {
    if (i > 0) {
      await space.startTyping().catch(() => {});
      await sleep(bubbleDelay(bubbles[i]!));
    }
    if (i === 0 && threaded && message) await message.reply(bubbles[i]!);
    else await space.send(bubbles[i]!);
  }
}

/** Streaming: peek at the first few characters so a bare NO_REPLY never gets sent. */
async function prepareStream(src: AsyncIterable<string>) {
  const it = src[Symbol.asyncIterator]();
  let buf = "";
  let done = false;
  while (buf.length < NO_REPLY.length + 2 && !done) {
    const n = await it.next();
    if (n.done) done = true;
    else buf += n.value;
  }
  let full = buf;
  async function* rest() {
    if (buf) yield buf;
    while (!done) {
      const n = await it.next();
      if (n.done) break;
      full += n.value;
      yield n.value;
    }
  }
  const skip = buf.trimStart().startsWith(NO_REPLY);
  return { skip, stream: rest(), full: () => full };
}

// --------------------------------------------------------------------------------------------
// 3. Burst debouncing + per-chat serial queue
// --------------------------------------------------------------------------------------------
// People text in bursts ("hey" / "can you" / "check the weather"). We wait a beat, merge, and
// answer once. Each chat is processed strictly in order so replies never interleave.
type Pending = { space: Space; messages: Message[]; timer?: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();
const queues = new Map<string, Promise<void>>();

function enqueue(space: Space, message: Message, spaceKey: string, userKey: string, isGroup: boolean) {
  const key = `${spaceKey}|${userKey}`;
  const p = pending.get(key) ?? { space, messages: [] };
  p.space = space;
  p.messages.push(message);
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    pending.delete(key);
    const prev = queues.get(spaceKey) ?? Promise.resolve();
    const next = prev
      .then(() => processBatch(p.space, p.messages, spaceKey, userKey, isGroup))
      .catch((e) => log.error("batch failed", e));
    queues.set(spaceKey, next);
    void next.finally(() => queues.get(spaceKey) === next && queues.delete(spaceKey));
  }, config.debounceMs);
  pending.set(key, p);
}

// --------------------------------------------------------------------------------------------
// 4. Handle one (merged) user turn
// --------------------------------------------------------------------------------------------
async function processBatch(space: Space, messages: Message[], spaceKey: string, userKey: string, isGroup: boolean) {
  const last = messages[messages.length - 1]!;

  // Parse everything the user sent in this burst.
  const parsed = await Promise.all(messages.map(parseInbound));
  const inboundText = parsed.map((p) => p.text).filter(Boolean).join("\n").trim();
  const images = parsed.flatMap((p) => p.images);
  const repliedToMe = parsed.some((p) => p.repliedToMe);
  if (!inboundText && images.length === 0) return;

  // Group etiquette: only speak when spoken to (name mention or a quoted reply to Muse).
  if (isGroup && !nameRe.test(inboundText) && !repliedToMe) return;

  log.info(`← ${mask(last.sender?.id)} ${isGroup ? "(group) " : ""}${inboundText.slice(0, 80).replace(/\n/g, " ")}${images.length ? ` [+${images.length} img]` : ""}`);

  // Mark as read (best effort) — it makes the agent feel present.
  if (!config.terminal) await last.read().catch(() => {});

  // First contact → welcome message.
  const isNewUser = touchUser(userKey);
  if (isNewUser && !isGroup) {
    await sendBubbles(space, last, WELCOME, false);
    appendTurn(spaceKey, "assistant", WELCOME.join("\n\n"));
    if (bareGreetingOrCommand(inboundText) === "greeting") return; // welcome already covered "hi"
  }

  // Slash-commands and "what can you do" are answered instantly, with no LLM call.
  if (images.length === 0) {
    const cmd = bareGreetingOrCommand(inboundText, userKey, spaceKey);
    if (Array.isArray(cmd)) {
      await sendBubbles(space, last, cmd, false);
      return;
    }
  }

  // Tools get a handle on *this* message so the model can tapback it.
  const ctx: ToolContext = {
    userKey,
    spaceKey,
    isGroup,
    scheduled: false,
    react: async (kind) => {
      try {
        return Boolean(await last.react(Emoji[kind]));
      } catch (e) {
        log.debug("react failed", e);
        return false;
      }
    },
  };

  const who = last.sender?.id ? `[…${last.sender.id.slice(-4)}] ` : "";
  const userText = isGroup ? `${who}${inboundText}` : inboundText;
  const historyUserText = images.length ? `${userText}\n[sent ${images.length} image(s)]`.trim() : userText;
  const input = { ctx, platform: last.platform, text: userText, images };

  try {
    // `responding` shows the "…" typing bubble for as long as the callback runs.
    await space.responding(async () => {
      if (config.streaming && !config.terminal) {
        // Live-edit mode: Spectrum sends the first chunk, then edits the message in place.
        const { textStream } = streamReplyText(input);
        const prepared = await prepareStream(textStream);
        if (prepared.skip) {
          appendTurn(spaceKey, "user", historyUserText);
          appendTurn(spaceKey, "assistant", "[reacted]");
          return;
        }
        await space.send(textContent(prepared.stream as any));
        appendTurn(spaceKey, "user", historyUserText);
        appendTurn(spaceKey, "assistant", prepared.full());
        return;
      }

      const reply = (await generateReply(input)).trim();
      appendTurn(spaceKey, "user", historyUserText);
      if (!reply || isNoReply(reply)) {
        appendTurn(spaceKey, "assistant", "[reacted]");
        return; // a tapback was the whole answer
      }
      appendTurn(spaceKey, "assistant", reply);
      await sendBubbles(space, last, toBubbles(reply), isGroup);
    });
  } catch (e) {
    log.error("turn failed", e);
    await space
      .send("Ugh, I hit a snag on that one 😅 Mind trying again in a sec?")
      .catch(() => {});
  }
}

// --------------------------------------------------------------------------------------------
// 5. The Spectrum message loop
// --------------------------------------------------------------------------------------------
async function onMessage(space: Space, message: Message) {
  if (message.direction === "outbound") return; // ignore our own echoes
  if (!isConversational(message)) return; // tapbacks, typing, read receipts, group events…

  const senderId = message.sender?.id;
  if (!senderId) return;
  if (config.allowedSenders.length && !config.allowedSenders.includes(senderId)) {
    log.debug(`ignored ${mask(senderId)} (not in MUSE_ALLOWED_SENDERS)`);
    return;
  }

  const spaceKey = `${message.platform}:${space.id}`;
  const userKey = `${message.platform}:${senderId}`;
  const isGroup = isGroupSpace(space, message);

  // Remember the live Space so reminders can message this chat later (and persist its id for restarts).
  registerSpace(spaceKey, space);
  rememberSpace(spaceKey, message.platform, space.id, isGroup);

  enqueue(space, message, spaceKey, userKey, isGroup);
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} received, shutting down…`);
  stopScheduler();
  try {
    await app.stop();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log.error("unhandled rejection", e as Error));

try {
  for await (const [space, message] of app.messages) {
    void onMessage(space, message).catch((e) => log.error("message handler failed", e));
  }
  log.warn("message stream ended");
} catch (e) {
  log.error("message stream crashed", e);
}
// Exit non-zero so Railway / Fly / Docker / systemd restarts us with a clean connection.
if (!stopping) process.exit(1);
