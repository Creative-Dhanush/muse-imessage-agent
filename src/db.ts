/**
 * SQLite persistence via Bun's built-in `bun:sqlite` (zero native deps).
 * Set MUSE_DB_PATH=:memory: for a purely in-memory run.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";
import type { Repeat } from "./timeutil";

if (config.dbPath !== ":memory:") mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,           -- "<platform>:<sender id>"
  timezone   TEXT,
  first_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  key       TEXT PRIMARY KEY,            -- "<platform>:<space id>"
  platform  TEXT NOT NULL,
  space_id  TEXT NOT NULL,
  is_group  INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  space_key TEXT NOT NULL,
  role      TEXT NOT NULL,               -- 'user' | 'assistant'
  content   TEXT NOT NULL,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_space ON messages(space_key, id);
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  due        TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE TABLE IF NOT EXISTS reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  space_key  TEXT NOT NULL,
  text       TEXT NOT NULL,
  agent_task TEXT,                        -- if set, Muse *runs* this at due time instead of sending text
  due_at     INTEGER NOT NULL,
  repeat     TEXT NOT NULL DEFAULT 'none',
  tz         TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at);
`);

// ---------------------------------------------------------------- users
export function getUser(id: string): { id: string; timezone: string | null; first_seen: number } | null {
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as any ?? null;
}
/** Returns true if this is the first time we've seen this user. */
export function touchUser(id: string): boolean {
  const res = db.query("INSERT OR IGNORE INTO users (id, first_seen) VALUES (?, ?)").run(id, Date.now());
  return res.changes > 0;
}
export function getTimezone(userId: string): string {
  return getUser(userId)?.timezone ?? config.defaultTimezone;
}
export function setTimezone(userId: string, tz: string) {
  db.query("UPDATE users SET timezone = ? WHERE id = ?").run(tz, userId);
}

// --------------------------------------------------------------- spaces
export function rememberSpace(key: string, platform: string, spaceId: string, isGroup: boolean) {
  db.query(
    `INSERT INTO spaces (key, platform, space_id, is_group, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET last_seen = excluded.last_seen, is_group = excluded.is_group`,
  ).run(key, platform, spaceId, isGroup ? 1 : 0, Date.now());
}
export function getSpaceRow(key: string): { platform: string; space_id: string; is_group: number } | null {
  return db.query("SELECT platform, space_id, is_group FROM spaces WHERE key = ?").get(key) as any ?? null;
}

// ------------------------------------------------------------- messages
export type Turn = { role: "user" | "assistant"; content: string };
const cache = new Map<string, Turn[]>(); // hot in-memory copy of recent history

export function loadHistory(spaceKey: string, limit: number): Turn[] {
  let turns = cache.get(spaceKey);
  if (!turns) {
    const rows = db
      .query("SELECT role, content FROM messages WHERE space_key = ? ORDER BY id DESC LIMIT ?")
      .all(spaceKey, limit * 2) as Turn[];
    turns = rows.reverse();
    cache.set(spaceKey, turns);
  }
  return turns.slice(-limit * 2);
}
export function appendTurn(spaceKey: string, role: Turn["role"], content: string) {
  // Warm the cache BEFORE inserting, otherwise the freshly inserted row would be loaded and then pushed again.
  const turns = cache.get(spaceKey) ?? (loadHistory(spaceKey, 50), cache.get(spaceKey)!);
  db.query("INSERT INTO messages (space_key, role, content, ts) VALUES (?, ?, ?, ?)").run(spaceKey, role, content, Date.now());
  turns.push({ role, content });
  if (turns.length > 200) turns.splice(0, turns.length - 100);
  cache.set(spaceKey, turns);
}
export function clearHistory(spaceKey: string) {
  db.query("DELETE FROM messages WHERE space_key = ?").run(spaceKey);
  cache.delete(spaceKey);
}

// ---------------------------------------------------------------- notes
export type Note = { id: number; text: string; created_at: number };
export const notes = {
  add(userId: string, text: string): Note {
    const created_at = Date.now();
    const r = db.query("INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)").run(userId, text, created_at);
    return { id: Number(r.lastInsertRowid), text, created_at };
  },
  list(userId: string, limit = 200): Note[] {
    return db.query("SELECT id, text, created_at FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit) as Note[];
  },
  search(userId: string, query: string, limit = 20): Note[] {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (!terms.length) return notes.list(userId, limit);
    return notes
      .list(userId)
      .map((n) => ({ n, score: terms.filter((t) => n.text.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.n);
  },
  remove(userId: string, id: number): boolean {
    return db.query("DELETE FROM notes WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  },
};

// ---------------------------------------------------------------- tasks
export type Task = { id: number; text: string; due: string | null; done: number; created_at: number };
export const tasks = {
  add(userId: string, text: string, due?: string): Task {
    const created_at = Date.now();
    const r = db.query("INSERT INTO tasks (user_id, text, due, created_at) VALUES (?, ?, ?, ?)").run(userId, text, due ?? null, created_at);
    return { id: Number(r.lastInsertRowid), text, due: due ?? null, done: 0, created_at };
  },
  list(userId: string, includeDone = false): Task[] {
    return db
      .query(`SELECT id, text, due, done, created_at FROM tasks WHERE user_id = ? ${includeDone ? "" : "AND done = 0"} ORDER BY done, id`)
      .all(userId) as Task[];
  },
  complete(userId: string, id: number): Task | null {
    const t = db.query("SELECT id, text, due, done, created_at FROM tasks WHERE id = ? AND user_id = ?").get(id, userId) as Task | null;
    if (!t) return null;
    db.query("UPDATE tasks SET done = 1 WHERE id = ?").run(id);
    return { ...t, done: 1 };
  },
  remove(userId: string, id: number): boolean {
    return db.query("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  },
};

// ------------------------------------------------------------ reminders
export type Reminder = {
  id: number; user_id: string; space_key: string; text: string; agent_task: string | null;
  due_at: number; repeat: Repeat; tz: string; attempts: number; created_at: number;
};
export const reminders = {
  add(r: Omit<Reminder, "id" | "attempts" | "created_at">): Reminder {
    const created_at = Date.now();
    const res = db
      .query("INSERT INTO reminders (user_id, space_key, text, agent_task, due_at, repeat, tz, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.user_id, r.space_key, r.text, r.agent_task, r.due_at, r.repeat, r.tz, created_at);
    return { ...r, id: Number(res.lastInsertRowid), attempts: 0, created_at };
  },
  listForUser(userId: string): Reminder[] {
    return db.query("SELECT * FROM reminders WHERE user_id = ? ORDER BY due_at").all(userId) as Reminder[];
  },
  due(now = Date.now()): Reminder[] {
    return db.query("SELECT * FROM reminders WHERE due_at <= ? AND attempts < 5 ORDER BY due_at").all(now) as Reminder[];
  },
  reschedule(id: number, dueAt: number) {
    db.query("UPDATE reminders SET due_at = ?, attempts = 0 WHERE id = ?").run(dueAt, id);
  },
  bumpAttempts(id: number) {
    // Back off 30s, 60s, 90s... so a flaky connection doesn't burn all attempts instantly.
    db.query("UPDATE reminders SET attempts = attempts + 1, due_at = MAX(due_at, ? + 30000 * (attempts + 1)) WHERE id = ?").run(Date.now(), id);
  },
  remove(id: number) {
    db.query("DELETE FROM reminders WHERE id = ?").run(id);
  },
  cancel(userId: string, id: number): boolean {
    return db.query("DELETE FROM reminders WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  },
};

// --------------------------------------------------------------- privacy
/** Delete everything we hold about a user (the /forget command). */
export function forgetUser(userId: string, spaceKey: string) {
  db.transaction(() => {
    db.query("DELETE FROM notes WHERE user_id = ?").run(userId);
    db.query("DELETE FROM tasks WHERE user_id = ?").run(userId);
    db.query("DELETE FROM reminders WHERE user_id = ?").run(userId);
    db.query("DELETE FROM users WHERE id = ?").run(userId);
  })();
  clearHistory(spaceKey);
}
