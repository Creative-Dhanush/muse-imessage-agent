import { describe, expect, test } from "bun:test";
import { DateTime } from "luxon";
import { handleCommand } from "../src/commands";
import { notes, reminders, tasks, loadHistory, appendTurn, getTimezone, touchUser, forgetUser } from "../src/db";
import { toBubbles, toPlainText, isNoReply } from "../src/format";
import { htmlToText, assertPublicUrl } from "../src/tools/web";
import { calculate } from "../src/tools/calc";
import { formatWhen, nextOccurrence, parseWhen } from "../src/timeutil";
import { buildTools } from "../src/tools";
import { buildSystemPrompt } from "../src/persona";

const ctx = { userKey: "imessage:+15550001111", spaceKey: "imessage:chat1", isGroup: false, scheduled: false };
const run = (t: any, input: any) => t.execute(input, { toolCallId: "x", messages: [] });

describe("time", () => {
  test("parses local times in the user's zone", () => {
    const ms = parseWhen("2026-10-07T09:00:00", "Asia/Kolkata")!;
    expect(DateTime.fromMillis(ms, { zone: "UTC" }).toFormat("HH:mm")).toBe("03:30");
  });
  test("repeat rules", () => {
    const fri = parseWhen("2026-10-09T08:00:00", "UTC")!; // a Friday
    const next = nextOccurrence(fri, "weekdays", "UTC", fri)!;
    expect(DateTime.fromMillis(next, { zone: "UTC" }).weekdayLong).toBe("Monday");
    const catchUp = nextOccurrence(fri, "daily", "UTC", fri + 5 * 86400_000)!;
    expect(catchUp).toBeGreaterThan(fri + 5 * 86400_000);
  });
  test("formatWhen is friendly", () => {
    const now = parseWhen("2026-10-07T12:00:00", "UTC")!;
    expect(formatWhen(parseWhen("2026-10-08T09:00:00", "UTC")!, "UTC", now)).toBe("tomorrow at 9:00 AM");
  });
});

describe("db", () => {
  test("notes, tasks, reminders are scoped per user", () => {
    notes.add("a", "likes oat milk");
    notes.add("b", "secret");
    expect(notes.search("a", "oat").length).toBe(1);
    expect(notes.list("a").length).toBe(1);
    const t = tasks.add("a", "buy milk");
    expect(tasks.complete("b", t.id)).toBeNull();
    expect(tasks.complete("a", t.id)?.done).toBe(1);
  });
  test("history round-trips and forget wipes", () => {
    touchUser("u1");
    appendTurn("s1", "user", "hi");
    appendTurn("s1", "assistant", "hello");
    expect(loadHistory("s1", 10).length).toBe(2);
    notes.add("u1", "x");
    forgetUser("u1", "s1");
    expect(loadHistory("s1", 10).length).toBe(0);
    expect(notes.list("u1").length).toBe(0);
  });
  test("due reminders", () => {
    const r = reminders.add({ user_id: "a", space_key: "s", text: "t", agent_task: null, due_at: Date.now() - 1000, repeat: "none", tz: "UTC" });
    expect(reminders.due().some((x) => x.id === r.id)).toBe(true);
  });
});

describe("tools", () => {
  test("calculator + units, and it can't escape", () => {
    expect(calculate("5 miles to km")).toContain("8.04");
    expect(calculate("(1299 * 0.0825) + 1299")).toContain("1406.1675");
    expect(() => calculate("import('fs')")).toThrow();
    expect(() => calculate("evaluate('1+1')")).toThrow();
  });
  test("set_reminder + list_reminders + cancel", async () => {
    const tools: any = buildTools(ctx);
    const out = await run(tools.set_reminder, { message: "Stretch", inMinutes: 10, repeat: "none" });
    expect(out.ok).toBe(true);
    expect(out.firesAt).toMatch(/today|tomorrow/);
    const list = await run(tools.list_reminders, {});
    expect(list.length).toBe(1);
    expect((await run(tools.cancel_reminder, { id: out.id })).ok).toBe(true);
    const past = await run(tools.set_reminder, { message: "x", when: "2001-01-01T00:00:00", repeat: "none" });
    expect(past.error).toBeDefined();
  });
  test("timezone tool validates", async () => {
    const tools: any = buildTools(ctx);
    expect((await run(tools.set_user_timezone, { timezone: "Mars/Olympus" })).error).toBeDefined();
    touchUser(ctx.userKey);
    expect((await run(tools.set_user_timezone, { timezone: "Europe/London" })).ok).toBe(true);
    expect(getTimezone(ctx.userKey)).toBe("Europe/London");
  });
  test("react tool only exists when a message can be reacted to", () => {
    expect((buildTools(ctx) as any).react_to_message).toBeUndefined();
    expect((buildTools({ ...ctx, react: async () => true }) as any).react_to_message).toBeDefined();
  });
  test("SSRF guard blocks private hosts", async () => {
    await expect(assertPublicUrl("http://localhost:8080")).rejects.toThrow();
    await expect(assertPublicUrl("http://169.254.169.254/latest")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
  });
  test("htmlToText strips scripts", () => {
    const { title, text } = htmlToText("<html><title>Hi</title><script>evil()</script><p>Hello &amp; welcome</p></html>");
    expect(title).toBe("Hi");
    expect(text).toBe("Hello & welcome");
  });
});

describe("commands & formatting", () => {
  test("help variants", () => {
    for (const q of ["/help", "help", "What can you do?", "who are you"]) expect(handleCommand(q, "u", "s")).not.toBeNull();
    expect(handleCommand("remind me to pay rent", "u", "s")).toBeNull();
  });
  test("forget requires confirmation", () => {
    expect(handleCommand("/forget", "z", "s")![0]).toContain("confirm");
    expect(handleCommand("/forget confirm", "z", "s")![0]).toContain("erased");
  });
  test("markdown is stripped and bubbles capped", () => {
    expect(toPlainText("**Hi** there\n- a\n- b")).toBe("Hi there\n• a\n• b");
    expect(toBubbles("a\n\nb\n\nc\n\nd\n\ne").length).toBe(3);
    expect(isNoReply("NO_REPLY")).toBe(true);
    expect(isNoReply("no reply needed")).toBe(false);
  });
  test("system prompt includes notes and time", () => {
    notes.add(ctx.userKey, "my dog is called Biscuit");
    const p = buildSystemPrompt({ userKey: ctx.userKey, isGroup: false, platform: "imessage" });
    expect(p).toContain("Biscuit");
    expect(p).toContain("Europe/London");
  });
});
