/** Per-turn context handed to every tool, so tools know *who* is asking and *where*. */
export interface ToolContext {
  /** "<platform>:<sender id>" — owner of notes / tasks / reminders. */
  userKey: string;
  /** "<platform>:<space id>" — where replies and reminders are delivered. */
  spaceKey: string;
  isGroup: boolean;
  /** True when Muse is running a scheduled task (no inbound message to react to). */
  scheduled: boolean;
  /** Send a tapback on the message being answered. Undefined for scheduled runs. */
  react?: (kind: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question") => Promise<boolean>;
}
