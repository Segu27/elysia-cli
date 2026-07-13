import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { log } from "./logger.js";
import { ensureGitignore } from "./gitignore.js";

/**
 * Garantit la présence de variables dans un fichier d'env (`.env.local` par
 * défaut) sans écraser les valeurs existantes. Crée le fichier au besoin et
 * s'assure qu'il est git-ignoré (les secrets ne doivent pas être committés).
 */
export function ensureEnvVars(
  vars: Record<string, string>,
  file = ".env.local",
): void {
  // Toujours ignorer le fichier d'env, même si aucune variable n'est ajoutée.
  ensureGitignore([file]);

  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing: string[] = [];

  for (const [key, value] of Object.entries(vars)) {
    if (!new RegExp(`^${key}=`, "m").test(content)) {
      missing.push(`${key}=${value}`);
    }
  }
  if (!missing.length) return;

  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  appendFileSync(file, prefix + missing.join("\n") + "\n");
  log.updated(`${file} (${missing.length} variable(s))`);
}
