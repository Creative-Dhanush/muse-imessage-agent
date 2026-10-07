/**
 * Central configuration. Everything comes from environment variables
 * (Bun loads `.env` automatically). Validation happens once, at boot, so a
 * missing key fails fast with a readable message instead of mid-conversation.
 */
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : /^(1|true|yes|on)$/i.test(v.trim())));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      return v === undefined || v.trim() === "" || !Number.isFinite(n) ? fallback : Math.trunc(n);
    });

const EnvSchema = z.object({
  // --- Photon / Spectrum ---------------------------------------------------
  SPECTRUM_PROJECT_ID: z.string().optional(),
  SPECTRUM_PROJECT_SECRET: z.string().optional(),
  // Aliases, because the Photon dashboard calls these PROJECT_ID / SECRET_KEY.
  PROJECT_ID: z.string().optional(),
  PROJECT_SECRET: z.string().optional(),
  /** Run in your terminal instead of iMessage (no Photon credentials needed). */
  MUSE_TERMINAL: bool(false),

  // --- LLM -----------------------------------------------------------------
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** Point at any OpenAI-compatible API (OpenRouter, Groq, Together, Ollama...). */
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Model used for voice-note transcription (OpenAI-compatible endpoint). */
  TRANSCRIPTION_MODEL: z.string().default("whisper-1"),

  // --- Tools ---------------------------------------------------------------
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),

  // --- Behaviour -----------------------------------------------------------
  MUSE_NAME: z.string().default("Muse"),
  DEFAULT_TIMEZONE: z.string().default("UTC"),
  MUSE_DB_PATH: z.string().default("./data/muse.db"),
  /** Stream replies live by editing the message in place (iMessage cloud only). */
  MUSE_STREAMING: bool(false),
  MUSE_HISTORY_TURNS: int(24),
  MUSE_DEBOUNCE_MS: int(1400),
  MUSE_MAX_STEPS: int(8),
  /** Comma-separated phone numbers/emails allowed to talk to Muse. Empty = everyone. */
  MUSE_ALLOWED_SENDERS: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
const env = parsed.data;

const provider = env.LLM_PROVIDER;
const defaultModel = provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o";

export const config = {
  name: env.MUSE_NAME,
  terminal: env.MUSE_TERMINAL,
  spectrum: {
    projectId: env.SPECTRUM_PROJECT_ID ?? env.PROJECT_ID,
    projectSecret: env.SPECTRUM_PROJECT_SECRET ?? env.PROJECT_SECRET,
  },
  llm: {
    provider,
    model: env.LLM_MODEL ?? defaultModel,
    openaiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    anthropicKey: env.ANTHROPIC_API_KEY,
    transcriptionModel: env.TRANSCRIPTION_MODEL,
  },
  search: { tavilyKey: env.TAVILY_API_KEY, braveKey: env.BRAVE_API_KEY },
  defaultTimezone: env.DEFAULT_TIMEZONE,
  dbPath: env.MUSE_DB_PATH,
  streaming: env.MUSE_STREAMING,
  historyTurns: Math.max(2, env.MUSE_HISTORY_TURNS),
  debounceMs: Math.max(0, env.MUSE_DEBOUNCE_MS),
  maxSteps: Math.max(2, env.MUSE_MAX_STEPS),
  allowedSenders: (env.MUSE_ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  logLevel: env.LOG_LEVEL,
} as const;

/** Throws a friendly error if required credentials for the chosen mode are missing. */
export function assertRuntimeConfig(): void {
  const problems: string[] = [];
  if (!config.terminal && (!config.spectrum.projectId || !config.spectrum.projectSecret)) {
    problems.push(
      "Missing Photon credentials. Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET (from https://app.photon.codes), " +
        "or set MUSE_TERMINAL=1 to chat in your terminal while developing.",
    );
  }
  if (config.llm.provider === "openai" && !config.llm.openaiKey) problems.push("Missing OPENAI_API_KEY.");
  if (config.llm.provider === "anthropic" && !config.llm.anthropicKey) problems.push("Missing ANTHROPIC_API_KEY.");
  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error("\nCopy .env.example to .env and fill it in.");
    process.exit(1);
  }
}
