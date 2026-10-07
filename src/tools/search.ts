/**
 * Web search with pluggable backends. Pick whichever key you have:
 *   1. Tavily  (TAVILY_API_KEY) — best for agents, generous free tier, returns an answer + clean snippets
 *   2. Brave   (BRAVE_API_KEY)  — free tier, classic web results
 *   3. DuckDuckGo HTML scrape   — no key needed (works out of the box, less reliable)
 */
import { tool } from "ai";
import { z } from "zod";
import { config } from "../config";
import { logger } from "../logger";
import { safeFetchText } from "./web";

const log = logger("search");

type Hit = { title: string; url: string; snippet: string };
type SearchResult = { answer?: string; results: Hit[]; source: string };

async function tavily(query: string, key: string): Promise<SearchResult> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 5, include_answer: true, search_depth: "basic" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const j = (await res.json()) as any;
  return {
    answer: j.answer,
    source: "tavily",
    results: (j.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: String(r.content ?? "").slice(0, 400) })),
  };
}

async function brave(query: string, key: string): Promise<SearchResult> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
    headers: { accept: "application/json", "x-subscription-token": key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const j = (await res.json()) as any;
  return {
    source: "brave",
    results: (j.web?.results ?? []).slice(0, 5).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: String(r.description ?? "").replace(/<[^>]+>/g, "").slice(0, 400),
    })),
  };
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");
}

async function duckduckgo(query: string): Promise<SearchResult> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; MuseBot/1.0)", accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const hits: Hit[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < 5) {
    let url = decodeEntities(m[1]!);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    if (url.startsWith("//")) url = "https:" + url;
    hits.push({
      title: decodeEntities(m[2]!.replace(/<[^>]+>/g, "")).trim(),
      url,
      snippet: decodeEntities(m[3]!.replace(/<[^>]+>/g, "")).trim().slice(0, 400),
    });
  }
  return { source: "duckduckgo", results: hits };
}

export async function webSearch(query: string): Promise<SearchResult> {
  const { tavilyKey, braveKey } = config.search;
  try {
    if (tavilyKey) return await tavily(query, tavilyKey);
    if (braveKey) return await brave(query, braveKey);
    return await duckduckgo(query);
  } catch (e) {
    log.warn(`primary search failed (${(e as Error).message}); trying DuckDuckGo fallback`);
    if (!tavilyKey && !braveKey) throw e;
    return duckduckgo(query);
  }
}

export const searchTools = {
  web_search: tool({
    description:
      "Search the live web for current information: news, prices, scores, businesses, facts that may have changed, anything you're unsure about. " +
      "Returns an optional direct answer plus top results. Follow up with read_webpage if you need the full article.",
    inputSchema: z.object({ query: z.string().describe("A concise search query, like you'd type into Google.") }),
    execute: async ({ query }) => {
      try {
        return await webSearch(query);
      } catch (e) {
        return { error: `Search failed: ${(e as Error).message}`, results: [] };
      }
    },
  }),

  read_webpage: tool({
    description:
      "Fetch a web page and return its readable text (truncated). Use it to summarize a link the user sent or to read a search result in depth.",
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      try {
        const { title, text, truncated } = await safeFetchText(url);
        return { url, title, text, truncated };
      } catch (e) {
        return { error: `Couldn't read that page: ${(e as Error).message}` };
      }
    },
  }),
};
