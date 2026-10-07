# Muse ✨ — the AI chief-of-staff that lives in your iMessage

Muse is a personal AI agent that you text like a friend. It remembers things, sets reminders (including *smart* recurring ones that actually do work), searches the web, reads your photos and voice notes, manages your to-do list, and behaves well in group chats. It is built on **[Photon Spectrum](https://docs.photon.codes/spectrum-ts/getting-started)** (`spectrum-ts`) so it runs in **real iMessage**, with TypeScript + Bun and the Vercel AI SDK.

> Built for the Photon Muse contest (deadline **Oct 19, 2026**) and aimed at **Most Time-Saving Muse**, with enough heart to also sit in *Inspiring*.

```
you:   remind me every weekday at 8am to brief me on weather and my tasks
muse:  Done ✅ Weekdays at 8:00 AM, starting tomorrow. I'll text you a full briefing.
        …next morning, unprompted…
muse:  Morning! ☀️ 24° and clear in Bengaluru, rain after 6pm. You've got 3 open tasks: …
```

---

## What it can do

| | |
|---|---|
| ⏰ **Reminders** | One-off or recurring (daily / weekdays / weekly / monthly). Timezone-aware. Survives restarts. |
| ☀️ **Smart scheduled tasks** | A reminder can carry an *instruction* ("morning briefing: weather + my tasks + top headlines"). At due time Muse **runs the agent with tools** and texts the result. |
| 🧠 **Memory** | "Remember that…" → saved notes, automatically injected into every conversation. Plus 24 turns of per-chat history. |
| ✅ **To-dos** | Add / list / complete / delete tasks in plain English. |
| 🔎 **Live web search** | Tavily, Brave, or keyless DuckDuckGo fallback. Plus `read_webpage` to summarize any link you text it. |
| 🌦 **Weather & time** | Open-Meteo (no key), any city; time in any timezone. |
| 🧮 **Calculator & units** | Sandboxed mathjs: `5 miles to km`, tip/tax math, etc. |
| 📸 **Vision** | Text it a photo or screenshot. |
| 🎙 **Voice notes** | Transcribed with Whisper (ffmpeg converts iMessage `.caf` files). |
| 📎 **Text files** | `.txt .md .csv .json .ics` are read and understood. |
| 👍 **Tapbacks** | Muse reacts like a human (❤️ 👍 😂 ‼️ ❓), often with a tapback *instead of* a reply to "thanks!". |
| 👥 **Group chats** | Only speaks when addressed (says "Muse" or you reply to its message). Threaded replies. |
| 🫧 **Human UX** | Typing indicator, marks messages read, merges rapid-fire texts, splits replies into natural bubbles, strips markdown. |
| 🔒 **Privacy** | `/forget` erases everything. Allow-list support. PII masked in logs. |

---

## Quick start

### 1. Photon credentials
1. Create a project at [app.photon.codes](https://app.photon.codes)
2. Enable the **iMessage** platform and get a line assigned
3. Copy `PROJECT_ID` and `PROJECT_SECRET` from Settings

### 2. Install & run
```bash
bun install
cp .env.example .env
# fill SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, OPENAI_API_KEY
bun run dev
```

**Zero-setup terminal mode** (no Photon needed while developing):
```bash
MUSE_TERMINAL=1 bun run dev
```

### Key env vars
| Var | Purpose |
|---|---|
| `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` | Photon credentials (required for iMessage) |
| `OPENAI_API_KEY` | LLM + voice transcription |
| `OPENAI_BASE_URL` | Use any OpenAI-compatible provider (OpenRouter, Groq, Ollama…) |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` | Better web search (optional) |
| `DEFAULT_TIMEZONE` | Used until a user tells Muse where they live |
| `MUSE_ALLOWED_SENDERS` | Comma-separated allow-list |
| `MUSE_STREAMING` | `true` = stream replies live by editing the bubble |
| `MUSE_DB_PATH` | SQLite path, or `:memory:` |

**Claude:** `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`

---

## Architecture

```
src/
├─ index.ts        Spectrum connection + message loop, debounce, per-chat queue
├─ agent.ts        Vercel AI SDK tool loop
├─ persona.ts      Personality, system prompt, welcome + help
├─ commands.ts     Instant slash-commands
├─ inbound.ts      Normalises text / photos / voice / files / links
├─ transcribe.ts   Voice notes → text
├─ format.ts       Strips markdown, chat bubbles
├─ scheduler.ts    Reminders & smart scheduled tasks
├─ spaces.ts       Live Spectrum Spaces for proactive texts
├─ db.ts           SQLite: users, history, notes, tasks, reminders
├─ llm.ts          Model factory
├─ config.ts       Zod-validated env config
└─ tools/          web_search, weather, calc, time, reminders, notes, react
```

### Photon / Spectrum (in `src/index.ts`)
```ts
const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
for await (const [space, message] of app.messages) { ... }
await space.responding(async () => { ... });  // typing indicator
await message.reply("…"); await message.react(Emoji.love);
```

### Smart reminders
`set_reminder({ message, when|inMinutes, repeat, agentTask })`. If `agentTask` is set, the scheduler runs the full agent at due time and texts the result.

---

## Deploying

Muse is a long-running **worker** (no HTTP port). Mount a persistent disk at `/data`.

**Railway:** Deploy from GitHub, set env vars, add volume at `/data`.

**Fly.io:**
```bash
fly launch --no-deploy --copy-config
fly volumes create muse_data --size 1
fly secrets set SPECTRUM_PROJECT_ID=... SPECTRUM_PROJECT_SECRET=... OPENAI_API_KEY=...
fly deploy
```

**Render:** Blueprint from `render.yaml` (Background Worker + disk).

**Docker:**
```bash
docker build -t muse . && docker run -d --restart=always -v muse_data:/data --env-file .env muse
```

Run **one** instance only (SQLite + reminder scheduler).

---

## Recording a winning demo

Requirements: real Photon iMessage, public X post with **demo video + chat screenshot**, tag `@PhotonHQ`, submit the Typeform.

Suggested shot list:
1. Text Muse for the first time → welcome
2. "remember that…" / "add buy milk"
3. Photo → Muse extracts tasks
4. Voice note → reminder
5. Link → tl;dr
6. "every weekday at 8am brief me on weather + my tasks"
7. Next morning: **proactive briefing arrives unprompted** (money shot)

Lead with *Time-Saving*; add a human line in the caption for *Inspiring* voters.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Missing Photon credentials | Set `SPECTRUM_PROJECT_ID` / `SECRET`, or `MUSE_TERMINAL=1` |
| No reply in iMessage | Process running? Texting the dashboard number? Platform enabled? |
| Group chat silent | Address Muse by name or reply to its messages |
| Voice notes fail | Needs `OPENAI_API_KEY` + ffmpeg (in Docker image) |
| Wrong reminder time | Tell Muse where you live, or `/timezone Asia/Kolkata` |
| Search flaky | Add free `TAVILY_API_KEY` |

## Honest notes
Verified: TypeScript typecheck, 16 unit tests, terminal-mode e2e against a mock LLM. **Test against a live Photon line before recording.** Written for `spectrum-ts@12.x`.

MIT licensed. Have fun, and good luck in the contest! 🏆
