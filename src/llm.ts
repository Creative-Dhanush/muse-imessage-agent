/** Model factory. Swap providers with LLM_PROVIDER=openai|anthropic (and LLM_MODEL). */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { config } from "./config";

export function getModel(): LanguageModel {
  if (config.llm.provider === "anthropic") {
    return createAnthropic({ apiKey: config.llm.anthropicKey })(config.llm.model);
  }
  const openai = createOpenAI({ apiKey: config.llm.openaiKey, baseURL: config.llm.openaiBaseUrl });
  // Third-party OpenAI-compatible servers generally only implement Chat Completions.
  return config.llm.openaiBaseUrl ? openai.chat(config.llm.model) : openai(config.llm.model);
}
