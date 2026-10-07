// Minimal fake OpenAI-compatible server used for offline smoke tests (no API key needed).
// Turn 1: asks for a set_reminder tool call. Turn 2 (after tool result): replies with text.
Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/chat/completions")) return new Response("nope", { status: 404 });
    const body = (await req.json()) as any;
    const msgs = body.messages as any[];
    const last = msgs[msgs.length - 1];
    const base = { id: "x", object: "chat.completion", created: 0, model: "fake" };
    if (last.role === "tool") {
      const r = JSON.parse(last.content);
      return Response.json({ ...base, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `Done ✅ I'll ping you ${r.firesAt}.\n\n**Anything else?**` } }] });
    }
    return Response.json({
      ...base,
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "set_reminder", arguments: JSON.stringify({ message: "Stretch", inMinutes: 10, repeat: "none" }) } }] } }],
    });
  },
});
console.log("fake llm on :8787");
