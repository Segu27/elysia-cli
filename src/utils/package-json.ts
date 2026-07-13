import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

/**
 * Ajoute des scripts au package.json du projet courant sans écraser ceux qui
 * existent déjà. Conserve l'indentation à 2 espaces.
 */
export function ensureScripts(scripts: Record<string, string>): void {
  const path = join(process.cwd(), "package.json");
  if (!existsSync(path)) {
    log.warn("package.json introuvable — scripts non ajoutés.");
    return;
  }

  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    scripts?: Record<string, string>;
  };
  pkg.scripts ??= {};

  const added: string[] = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    if (pkg.scripts[name] === undefined) {
      pkg.scripts[name] = cmd;
      added.push(name);
    }
  }
  if (!added.length) return;

  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  log.updated(`package.json (scripts : ${added.join(", ")})`);
}
