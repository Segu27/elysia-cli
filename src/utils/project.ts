import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project } from "ts-morph";
import { CliError } from "./logger.js";

export interface ElysiaCliConfig {
  /** Racine du code source. */
  srcDir: string;
  /** Dossier où sont générés les modules. */
  modulesDir: string;
  /** Fichier d'entrée qui instancie l'app Elysia. */
  appEntry: string;
  /** Nom de la variable Elysia dans l'app entry (pour l'injection du .use()). */
  appVariable: string;
  /** Fichier agrégateur des modules (où `generate module` branche les controllers). */
  modulesEntry: string;
  /** Nom de la variable Elysia dans l'agrégateur des modules. */
  modulesVariable: string;
}

const DEFAULT_CONFIG: ElysiaCliConfig = {
  srcDir: "src",
  modulesDir: "src/modules",
  appEntry: "src/index.ts",
  appVariable: "app",
  modulesEntry: "src/modules/index.ts",
  modulesVariable: "modules",
};

const CONFIG_FILE = "elysia-cli.config.json";

/** Résout la config du projet cible (fichier optionnel + defaults). */
export function loadConfig(cwd = process.cwd()): ElysiaCliConfig {
  const configPath = join(cwd, CONFIG_FILE);
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (err) {
    throw new CliError(
      `Impossible de lire ${CONFIG_FILE}: ${(err as Error).message}`,
    );
  }
}

/**
 * Charge un Project ts-morph pointant sur le tsconfig du projet cible.
 * Utilisé pour les opérations d'injection (add / register de plugin).
 */
export function loadTsProject(cwd = process.cwd()): Project {
  const tsconfigPath = join(cwd, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    return new Project({ tsConfigFilePath: tsconfigPath });
  }
  // Fallback sans tsconfig : projet en mémoire, on ajoute les fichiers à la demande.
  return new Project({ skipAddingFilesFromTsConfig: true });
}

/** Chemin absolu vers le dossier d'un module. */
export function moduleDir(config: ElysiaCliConfig, kebabName: string): string {
  return resolve(process.cwd(), config.modulesDir, kebabName);
}
