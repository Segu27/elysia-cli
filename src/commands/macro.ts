import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import * as p from "@clack/prompts";
import { buildNames, nameError, assertValidName } from "../utils/naming.js";
import { loadConfig, loadTsProject } from "../utils/project.js";
import { registerUse, moduleSpecifierFrom } from "../utils/inject.js";
import { macroTemplate } from "../templates.js";
import { log, CliError } from "../utils/logger.js";

/**
 * `macro <name>` — génère une macro Elysia dans `src/macros/<name>.macro.ts`
 * et la branche dans l'app entry via `.use(<name>Macro)`.
 */
export function registerMacroCommand(program: Command) {
  program
    .command("macro")
    .description("Génère une macro Elysia et la branche dans l'app")
    .argument("[name]", "nom de la macro (ex: auth, roles)")
    .option("--no-register", "ne pas injecter le .use() dans l'app entry")
    .action(async (name?: string, opts?: { register: boolean }) => {
      let n = name;
      if (!n) {
        const answer = await p.text({
          message: "Nom de la macro ?",
          placeholder: "auth",
          validate: nameError,
        });
        if (p.isCancel(answer)) throw new CliError("Annulé.");
        n = answer as string;
      }
      assertValidName(n);

      const names = buildNames(n);
      const config = loadConfig();

      const rel = join(config.srcDir, "macros", `${names.kebab}.macro.ts`);
      const target = join(process.cwd(), rel);
      if (existsSync(target)) {
        log.skipped(rel);
      } else {
        mkdirSync(join(process.cwd(), config.srcDir, "macros"), { recursive: true });
        writeFileSync(target, macroTemplate(names), "utf8");
        log.created(rel);
      }

      if (opts?.register ?? true) {
        const project = loadTsProject();
        const macroVar = `${names.camel}Macro`;
        registerUse(
          project,
          { entry: config.appEntry, variable: config.appVariable },
          {
            useExpr: macroVar,
            ensureImport: {
              names: [macroVar],
              moduleSpecifier: moduleSpecifierFrom(
                config.appEntry,
                join(config.srcDir, "macros", `${names.kebab}.macro`),
              ),
            },
          },
        );
      }

      log.success(`Macro ${names.camel} générée.`);
    });
}
