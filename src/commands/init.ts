import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import * as p from "@clack/prompts";
import { loadTsProject, type ElysiaCliConfig } from "../utils/project.js";
import {
  removeRootRoute,
  registerUse,
  moduleSpecifierFrom,
} from "../utils/inject.js";
import { nameError, assertValidName } from "../utils/naming.js";
import { modulesIndexTemplate } from "../templates.js";
import { applyPlugin, PLUGIN_KEYS } from "./add.js";
import { installDeps } from "../utils/pm.js";
import { log, CliError } from "../utils/logger.js";

/**
 * `init <project>` — délègue le scaffolding à `bun create elysia`, puis :
 *  - pose la config elysia-cli + le dossier modules,
 *  - déplace la route racine par défaut dans src/modules/index.ts,
 *  - propose d'ajouter des plugins directement.
 */
export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Bootstrap d'un projet Elysia (via `bun create elysia`)")
    .argument("[project]", "nom du dossier projet")
    .option(
      "--skip-scaffold",
      "ne pas lancer `bun create elysia` (dossier déjà existant)",
    )
    .action(async (project?: string, opts?: { skipScaffold?: boolean }) => {
      let name = project;
      if (!name) {
        const answer = await p.text({
          message: "Nom du projet ?",
          placeholder: "my-api",
          validate: nameError,
        });
        if (p.isCancel(answer)) throw new CliError("Annulé.");
        name = answer as string;
      }
      assertValidName(name);

      const root = join(process.cwd(), name);

      // 1. Scaffolding officiel Elysia (OK si dossier inexistant ou vide).
      if (!opts?.skipScaffold) {
        if (existsSync(root) && !isEmptyDir(root)) {
          throw new CliError(
            `Le dossier ${name} existe déjà et n'est pas vide ` +
              `(utilise --skip-scaffold pour l'enrichir).`,
          );
        }
        log.title(`Scaffolding : bun create elysia ${name}`);
        const res = spawnSync("bun", ["create", "elysia", name], {
          stdio: "inherit",
          cwd: process.cwd(),
          shell: true,
        });
        if (res.error) {
          throw new CliError(
            "Impossible de lancer `bun`. Bun est-il installé ? (bun --version)",
          );
        }
        if (res.status !== 0) throw new CliError("`bun create elysia` a échoué.");
      } else if (!existsSync(root)) {
        throw new CliError(`Le dossier ${name} n'existe pas — retire --skip-scaffold.`);
      }

      // À partir d'ici on travaille DANS le projet.
      process.chdir(root);

      // 2. Config elysia-cli + dossier modules.
      log.title("Configuration elysia-cli");
      const config: ElysiaCliConfig = {
        srcDir: "src",
        modulesDir: "src/modules",
        appEntry: "src/index.ts",
        appVariable: "app",
        modulesEntry: "src/modules/index.ts",
        modulesVariable: "modules",
      };
      mkdirSync(config.modulesDir, { recursive: true });

      const configPath = "elysia-cli.config.json";
      if (existsSync(configPath)) {
        log.skipped(configPath);
      } else {
        writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
        log.created(configPath);
      }

      // 3. Déplace la route racine par défaut dans src/modules/index.ts.
      relocateRootRoute(config);

      // 4. Plugins à ajouter directement.
      const selected = await p.multiselect({
        message: "Plugins à ajouter maintenant ? (espace pour sélectionner)",
        options: PLUGIN_KEYS.map((k) => ({ value: k, label: k })),
        required: false,
      });
      if (!p.isCancel(selected) && Array.isArray(selected) && selected.length) {
        log.title("Ajout des plugins");
        // Ordre canonique (prisma avant better-auth pour l'adapter).
        const chosen = PLUGIN_KEYS.filter((k) => (selected as string[]).includes(k));
        const pkgs = new Set<string>();
        const devPkgs = new Set<string>();
        const posts: Array<() => void> = [];
        for (const key of chosen) {
          const res = await applyPlugin(key, config);
          res.pkgs.forEach((x) => pkgs.add(x));
          res.devPkgs.forEach((x) => devPkgs.add(x));
          if (res.postInstall) posts.push(res.postInstall);
        }
        installDeps([...pkgs]);
        installDeps([...devPkgs], { dev: true });
        for (const fn of posts) fn();
      }

      log.success(`Projet ${name} prêt.`);
      log.info(`cd ${name} && bun dev`);
    });
}

/** Décroche la route `.get("/")` de l'app entry et la place dans le module racine. */
function relocateRootRoute(config: ElysiaCliConfig): void {
  const project = loadTsProject();
  const app = { entry: config.appEntry, variable: config.appVariable };
  const handler = removeRootRoute(project, app);

  if (!existsSync(config.modulesEntry)) {
    mkdirSync(config.modulesDir, { recursive: true });
    writeFileSync(
      config.modulesEntry,
      modulesIndexTemplate(handler ?? '() => "Hello Elysia"'),
      "utf8",
    );
    log.created(config.modulesEntry);
  } else {
    log.skipped(config.modulesEntry);
  }

  registerUse(project, app, {
    useExpr: config.modulesVariable,
    ensureImport: {
      names: [config.modulesVariable],
      moduleSpecifier: moduleSpecifierFrom(config.appEntry, config.modulesDir),
    },
  });
}

/** Un dossier est considéré « vide » s'il ne contient que des fichiers bruit. */
function isEmptyDir(dir: string): boolean {
  const IGNORED = new Set([".git", ".DS_Store", "Thumbs.db", ".keep", ".gitkeep"]);
  return readdirSync(dir).every((entry) => IGNORED.has(entry));
}
