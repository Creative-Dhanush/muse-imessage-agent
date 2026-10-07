/** Small bridge between raw text and the command handler / greeting detector. */
import { handleCommand, isBareGreeting } from "./commands";

/**
 * - With userKey+spaceKey: returns the command's reply bubbles, or null if it isn't a command.
 * - Without them: classifies the text as a bare "greeting" (or null).
 */
export function bareGreetingOrCommand(text: string): "greeting" | null;
export function bareGreetingOrCommand(text: string, userKey: string, spaceKey: string): string[] | null;
export function bareGreetingOrCommand(text: string, userKey?: string, spaceKey?: string): string[] | "greeting" | null {
  if (userKey && spaceKey) return handleCommand(text, userKey, spaceKey);
  return isBareGreeting(text) ? "greeting" : null;
}
