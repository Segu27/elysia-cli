import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import type { Command } from "commander";
import * as p from "@clack/prompts";
import type { Project } from "ts-morph";
import {
  buildNames,
  nameError,
  assertValidName,
  type NameSet,
} from "../utils/naming.js";
import {
  loadConfig,
  loadTsProject,
  moduleDir,
  type ElysiaCliConfig,
} from "../utils/project.js";
import { registerUse, moduleSpecifierFrom } from "../utils/inject.js";
import { log, CliError } from "../utils/logger.js";
import {
  controllerTemplate,
  serviceTemplate,
  modelTemplate,
  barrelTemplate,
  modulesIndexTemplate,
} from "../templates.js";

type Kind = "module" | "service" | "model";
const KINDS: Kind[] = ["module", "service", "model"];

export function registerGenerateCommand(program: Command) {
  program
    .command("generate")
    .alias("g")
    .description("Génère un module, service ou model Elysia")
    .argument("[kind]", "module | service | model")
    .argument("[name]", "nom (ex: user, user-profile)")
    .option("--no-register", "ne pas injecter le .use() dans l'app entry")
    .action(async (kind?: string, name?: string, opts?: { register: boolean }) => {
      const resolved = await resolveArgs(kind, name);
      const names = buildNames(resolved.name);
      const config = loadConfig();

      switch (resolved.kind) {
        case "module":
          generateModule(names, config, opts?.register ?? true);
          break;
        case "service":
          writeSingle(config, names, "service", serviceTemplate(names));
          break;
        case "model":
          writeSingle(config, names, "model", modelTemplate(names));
          break;
      }
    });
}

async function resolveArgs(
  kind?: string,
  name?: string,
): Promise<{ kind: Kind; name: string }> {
  let k = kind as Kind | undefined;
  if (!k) {
    const answer = await p.select({
      message: "Que veux-tu générer ?",
      options: KINDS.map((v) => ({ value: v, label: v })),
    });
    if (p.isCancel(answer)) throw new CliError("Annulé.");
    k = answer as Kind;
  }
  if (!KINDS.includes(k)) {
    throw new CliError(`Type inconnu "${k}". Attendu : ${KINDS.join(", ")}.`);
  }

  let n = name;
  if (!n) {
    const answer = await p.text({
      message: `Nom du ${k} ?`,
      placeholder: "user",
      validate: nameError,
    });
    if (p.isCancel(answer)) throw new CliError("Annulé.");
    n = answer as string;
  }
  assertValidName(n);
  return { kind: k, name: n };
}

function generateModule(names: NameSet, config: ReturnType<typeof loadConfig>, register: boolean) {
  const dir = moduleDir(config, names.kebab);
  log.title(`Génération du module ${names.pascal}`);

  const files: Array<[string, string]> = [
    [`${names.kebab}.controller.ts`, controllerTemplate(names)],
    [`${names.kebab}.service.ts`, serviceTemplate(names)],
    [`${names.kebab}.model.ts`, modelTemplate(names)],
    ["index.ts", barrelTemplate(names)],
  ];

  mkdirSync(dir, { recursive: true });
  for (const [file, content] of files) {
    const full = join(dir, file);
    if (existsSync(full)) {
      log.skipped(relative(process.cwd(), full));
      continue;
    }
    writeFileSync(full, content, "utf8");
    log.created(relative(process.cwd(), full));
  }

  if (register) {
    const project = loadTsProject();
    ensureModulesAggregator(project, config);

    const importPath = join(config.modulesDir, names.kebab); // dossier => index barrel
    const controllerVar = names.camel;
    registerUse(
      project,
      { entry: config.modulesEntry, variable: config.modulesVariable },
      {
        useExpr: controllerVar,
        ensureImport: {
          names: [controllerVar],
          moduleSpecifier: moduleSpecifierFrom(config.modulesEntry, importPath),
        },
      },
    );
  }

  log.success(`Module ${names.pascal} prêt.`);
}

function writeSingle(
  config: ReturnType<typeof loadConfig>,
  names: NameSet,
  kind: "service" | "model",
  content: string,
) {
  const dir = moduleDir(config, names.kebab);
  mkdirSync(dir, { recursive: true });
  const full = join(dir, `${names.kebab}.${kind}.ts`);
  if (existsSync(full)) {
    throw new CliError(`${relative(process.cwd(), full)} existe déjà.`);
  }
  writeFileSync(full, content, "utf8");
  log.created(relative(process.cwd(), full));
  log.success(`${kind} ${names.pascal} généré.`);
}

/**
 * Garantit l'existence de l'agrégateur `src/modules/index.ts` : s'il manque, le
 * crée (instance `modules` vide) et le branche dans l'app entry via `.use(modules)`.
 */
function ensureModulesAggregator(project: Project, config: ElysiaCliConfig): void {
  const abs = resolve(process.cwd(), config.modulesEntry);
  if (existsSync(abs)) return;

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, modulesIndexTemplate(), "utf8");
  log.created(relative(process.cwd(), abs));

  registerUse(
    project,
    { entry: config.appEntry, variable: config.appVariable },
    {
      useExpr: config.modulesVariable,
      ensureImport: {
        names: [config.modulesVariable],
        moduleSpecifier: moduleSpecifierFrom(config.appEntry, config.modulesDir),
      },
    },
  );
}
