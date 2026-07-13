import { spawnSync } from "node:child_process";
import { log, CliError } from "./logger.js";

/**
 * Installe des dépendances dans le projet courant via `bun add`.
 * Dédoublonne, ignore la liste vide, et remonte une erreur si l'install échoue.
 */
export function installDeps(pkgs: string[], opts: { dev?: boolean } = {}): void {
  const unique = [...new Set(pkgs)].filter(Boolean);
  if (!unique.length) return;

  const devFlag = opts.dev ? ["-d"] : [];
  log.info(`Installation : bun add ${devFlag.join(" ")} ${unique.join(" ")}`.trim());
  const res = spawnSync("bun", ["add", ...devFlag, ...unique], {
    stdio: "inherit",
    shell: true,
  });
  if (res.error) {
    throw new CliError("Impossible de lancer `bun add` (Bun est-il installé ?).");
  }
  if (res.status !== 0) {
    throw new CliError("`bun add` a échoué.");
  }
}

/**
 * Exécute une commande best-effort : logue, ne jette pas si elle échoue
 * (utile pour les migrations qui nécessitent une base de données joignable).
 * Retourne `true` si la commande a réussi.
 */
export function run(label: string, cmd: string, args: string[]): boolean {
  log.info(`${label} : ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (res.error || res.status !== 0) {
    log.warn(`Échec de "${label}" — à relancer manuellement.`);
    return false;
  }
  return true;
}
