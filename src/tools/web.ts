/** Safe-ish page fetching + HTML→text, used by the read_webpage tool. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 2_000_000;
const MAX_CHARS = 9_000;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Block localhost / private networks so a prompt-injected URL can't probe your infra (SSRF). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Private hosts are blocked");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Private network addresses are blocked");
  return url;
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  let body = html
    .replace(/<(head|title|script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  body = body
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
  return { title, text: body };
}

export async function safeFetchText(raw: string): Promise<{ title: string; text: string; truncated: boolean }> {
  let url = await assertPublicUrl(raw);
  let res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; MuseBot/1.0)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(12_000),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await assertPublicUrl(new URL(loc, url).toString()); // re-validate every redirect hop
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? "error"}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/|json|xml/i.test(type)) throw new Error(`Unsupported content type: ${type || "unknown"}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const raw8 = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
  const { title, text } = /html/i.test(type) ? htmlToText(raw8) : { title: "", text: raw8 };
  return { title, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
}
