import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { constants } from "node:fs";

export async function findRealCodex() {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = join(dir, "codex");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching.
    }
  }
  throw new Error("Could not find the real 'codex' executable on PATH.");
}

export function isInteractiveCodex(args) {
  const command = args.find((arg) => !arg.startsWith("-"));
  if (!command) return true;
  return !["exec", "e", "review", "login", "logout", "mcp", "plugin", "doctor", "completion", "update"].includes(command);
}
