/**
 * Deterministic slash-commands. These answer instantly (no LLM call, no cost)
 * and make for a crisp demo. Natural-language equivalents are handled by the LLM.
 */
import { DateTime } from "luxon";
import { HELP_TEXT } from "./persona";
import { clearHistory, forgetUser, getTimezone, notes, reminders, setTimezone, tasks } from "./db";
import { formatWhen, isValidZone } from "./timeutil";

export type CommandResult = string[] | null;

const HELP_RE = /^(\/?help|\/start|\/about|\/commands|what can you do\??|what do you do\??|who are you\??|what are you\??|what is this\??|how do (you|i use you|this work)\??)$/i;

const pendingForget = new Map<string, number>();

export function handleCommand(rawText: string, userKey: string, spaceKey: string): CommandResult {
  const text = rawText.trim().replace(/[.!]+$/, "");
  if (HELP_RE.test(text)) return HELP_TEXT;

  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  const tz = getTimezone(userKey);

  switch (cmd?.toLowerCase()) {
    case "/reset":
    case "/new":
      clearHistory(spaceKey);
      return ["Fresh start 🧼 I've cleared our chat context. Your notes, tasks and reminders are untouched."];

    case "/notes": {
      const list = notes.list(userKey, 30);
      if (!list.length) return ["No notes yet. Tell me \"remember that…\" and I'll keep it safe 🧠"];
      return [`Your notes (${list.length}):\n` + list.map((n) => `• ${n.text}`).join("\n")];
    }

    case "/tasks":
    case "/todo": {
      const list = tasks.list(userKey);
      if (!list.length) return ["Nothing on your list. Suspiciously productive 😎"];
      return [`To do (${list.length}):\n` + list.map((t, i) => `${i + 1}. ${t.text}${t.due ? ` (${t.due})` : ""}`).join("\n")];
    }

    case "/reminders": {
      const list = reminders.listForUser(userKey);
      if (!list.length) return ["No reminders set. Say \"remind me to…\" anytime ⏰"];
      return [
        "Upcoming:\n" +
          list.map((r) => `⏰ ${r.text} — ${formatWhen(r.due_at, tz)}${r.repeat !== "none" ? ` (${r.repeat})` : ""}`).join("\n"),
      ];
    }

    case "/timezone":
    case "/tz": {
      if (!arg) return [`Your timezone is ${tz} (it's ${DateTime.now().setZone(tz).toFormat("h:mm a")} for you). Change it with /timezone America/New_York, or just tell me where you live.`];
      if (!isValidZone(arg)) return [`I don't know "${arg}". Use an IANA name like Europe/London or Asia/Kolkata.`];
      setTimezone(userKey, arg);
      return [`Timezone set to ${arg}. It's ${DateTime.now().setZone(arg).toFormat("h:mm a")} there now.`];
    }

    case "/forget": {
      const pending = pendingForget.get(userKey);
      if (arg.toLowerCase() === "confirm" && pending && Date.now() - pending < 120_000) {
        pendingForget.delete(userKey);
        forgetUser(userKey, spaceKey);
        return ["Done. I've erased your notes, tasks, reminders and our chat history. Nice to have met you 👋"];
      }
      pendingForget.set(userKey, Date.now());
      return ["This permanently deletes ALL your notes, tasks, reminders and chat history. Reply \"/forget confirm\" within 2 minutes to proceed."];
    }
  }
  return null;
}

const GREETING_RE = /^(hi+|hey+|hello+|yo|sup|hola|heya|good (morning|evening|afternoon)|gm)[!. ]*$/i;
export const isBareGreeting = (t: string) => GREETING_RE.test(t.trim());
