/**
 * Turn whatever the user sent (text, photo, voice note, file, link, quoted reply...)
 * into one normalised `Inbound` the agent can reason about.
 */
import type { Message } from "spectrum-ts";
import { logger } from "./logger";
import { canTranscribe, transcribe } from "./transcribe";

const log = logger("inbound");

export interface Inbound {
  text: string;
  images: { data: Uint8Array; mediaType: string }[];
  /** True if the user quoted-replied to one of Muse's own messages (used for group addressing). */
  repliedToMe: boolean;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_FILE_CHARS = 20_000;
const TEXTY = /^(text\/|application\/(json|xml|x-yaml|yaml|csv)|application\/x-?sh)/i;

type Content = Message["content"];

async function collect(content: Content, out: Inbound, parts: string[]): Promise<void> {
  const c = content as any;
  switch (c.type) {
    case "text":
      if (c.text?.trim()) parts.push(c.text.trim());
      return;

    case "richlink":
      parts.push(c.url);
      return;

    case "reply": {
      const target = c.target as Message | undefined;
      if (target?.direction === "outbound") out.repliedToMe = true;
      const quoted = (target?.content as any)?.type === "text" ? String((target!.content as any).text).slice(0, 160) : null;
      if (quoted) parts.push(`(replying to: "${quoted}")`);
      return collect(c.content, out, parts);
    }

    case "group":
      for (const item of c.items as Message[]) await collect(item.content, out, parts);
      return;

    case "attachment": {
      const mime: string = c.mimeType ?? "application/octet-stream";
      const name: string = c.name ?? "file";
      try {
        if (mime.startsWith("image/")) {
          if ((c.size ?? 0) > MAX_IMAGE_BYTES) return void parts.push(`[Image "${name}" is too large for me to view]`);
          const data = new Uint8Array(await c.read());
          // HEIC/HEIF are common from iPhones but unsupported by most vision APIs.
          if (/hei[cf]/i.test(mime)) {
            parts.push(`[The user sent a HEIC photo "${name}" which I can't view yet. Ask them to resend it as a screenshot or JPEG.]`);
          } else {
            out.images.push({ data, mediaType: mime });
          }
        } else if (TEXTY.test(mime) || /\.(txt|md|csv|json|log|ics|vcf)$/i.test(name)) {
          const body = new TextDecoder().decode(new Uint8Array(await c.read())).slice(0, MAX_TEXT_FILE_CHARS);
          parts.push(`[File "${name}" contents]\n${body}\n[end of file]`);
        } else {
          parts.push(`[The user sent a file "${name}" (${mime}) which I can't open yet. Tell them what you CAN read: photos, text files, voice notes, links.]`);
        }
      } catch (e) {
        log.warn(`couldn't read attachment ${name}`, e);
        parts.push(`[An attachment "${name}" failed to download]`);
      }
      return;
    }

    case "voice": {
      if (!canTranscribe()) {
        parts.push("[The user sent a voice note, but voice transcription isn't enabled. Tell them to type it instead.]");
        return;
      }
      try {
        const data = new Uint8Array(await c.read());
        const transcript = await transcribe(data, c.mimeType ?? "audio/mp4");
        parts.push(transcript ? `[Voice note transcript] ${transcript}` : "[The voice note was silent or unintelligible]");
      } catch (e) {
        log.warn("voice transcription failed", e);
        parts.push("[The user sent a voice note I couldn't transcribe. Ask them to type it or try again.]");
      }
      return;
    }

    case "contact": {
      const bits = [c.name?.formatted, ...(c.phones ?? []).map((p: any) => p.value ?? p), ...(c.emails ?? []).map((e: any) => e.value ?? e)].filter(Boolean);
      parts.push(`[The user shared a contact card: ${bits.join(", ") || "unnamed"}]`);
      return;
    }

    case "poll":
      parts.push(`[Poll: ${c.title}]`);
      return;

    default:
      // reaction, typing, read, edit, unsend, group events, etc. → nothing to answer.
      return;
  }
}

export async function parseInbound(message: Message): Promise<Inbound> {
  const out: Inbound = { text: "", images: [], repliedToMe: false };
  const parts: string[] = [];
  await collect(message.content, out, parts);
  out.text = parts.join("\n").trim();
  return out;
}

/** Cheap pre-check (no downloads) so we can ignore tapbacks, typing, read receipts, etc. */
export function isConversational(message: Message): boolean {
  const t = (message.content as any).type as string;
  return ["text", "richlink", "attachment", "voice", "contact", "reply", "group", "poll"].includes(t);
}
