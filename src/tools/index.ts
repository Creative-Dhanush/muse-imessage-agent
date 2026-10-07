import type { ToolSet } from "ai";
import { calcTools } from "./calc";
import type { ToolContext } from "./context";
import { noteTools } from "./notes";
import { reactTools } from "./react";
import { reminderTools } from "./reminders";
import { searchTools } from "./search";
import { timeTools } from "./time";
import { weatherTools } from "./weather";

export type { ToolContext } from "./context";

/** Assemble the full toolbox for one turn. Add your own tools here. */
export function buildTools(ctx: ToolContext): ToolSet {
  return {
    ...searchTools,
    ...weatherTools,
    ...calcTools,
    ...timeTools(ctx),
    ...reminderTools(ctx),
    ...noteTools(ctx),
    ...reactTools(ctx),
  };
}
