/**
 * Voice-note transcription through any OpenAI-compatible /audio/transcriptions endpoint.
 * iMessage voice notes are usually .caf, which Whisper rejects, so we convert to mp3 with
 * ffmpeg when it's installed (the Dockerfile installs it).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config";

const NATIVE = /(mpeg|mp3|mp4|m4a|x-m4a|wav|x-wav|webm|ogg|flac|mpga)/i;

async function ffmpegToMp3(data: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "muse-"));
  try {
    const inPath = join(dir, "in.audio");
    const outPath = join(dir, "out.mp3");
    await writeFile(inPath, data);
    const proc = Bun.spawn(["ffmpeg", "-y", "-loglevel", "error", "-i", inPath, "-ac", "1", "-ar", "16000", outPath], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${await new Response(proc.stderr).text()}`);
    return new Uint8Array(await readFile(outPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function canTranscribe(): boolean {
  return Boolean(config.llm.openaiKey);
}

export async function transcribe(data: Uint8Array, mimeType: string): Promise<string> {
  if (!config.llm.openaiKey) throw new Error("Voice transcription needs OPENAI_API_KEY");
  let audio = data;
  let type = mimeType;
  if (!NATIVE.test(mimeType)) {
    audio = await ffmpegToMp3(data);
    type = "audio/mpeg";
  }
  const ext = /wav/i.test(type) ? "wav" : /ogg/i.test(type) ? "ogg" : /webm/i.test(type) ? "webm" : /m4a|mp4/i.test(type) ? "m4a" : "mp3";
  const form = new FormData();
  form.append("file", new Blob([audio as any], { type }), `voice.${ext}`);
  form.append("model", config.llm.transcriptionModel);
  const base = (config.llm.openaiBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.llm.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
  return String(((await res.json()) as any).text ?? "").trim();
}
