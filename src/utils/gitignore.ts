import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

/**
 * Garantit que des entrées figurent dans le .gitignore du projet courant.
 * Évite notamment de committer les secrets (.env.local).
 */
export function ensureGitignore(entries: string[]): void {
  const path = join(process.cwd(), ".gitignore");
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));

  const missing = entries.filter((e) => !present.has(e));
  if (!missing.length) return;

  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  appendFileSync(path, prefix + missing.join("\n") + "\n");
  log.updated(`.gitignore (${missing.join(", ")})`);
}
