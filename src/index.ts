#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { log, CliError } from "./utils/logger.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerAddCommand } from "./commands/add.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMacroCommand } from "./commands/macro.js";

const program = new Command();

program
  .name("elysia-cli")
  .description("Scaffolding pour projets ElysiaJS")
  .version("0.1.0");

registerGenerateCommand(program);
registerAddCommand(program);
registerInitCommand(program);
registerMacroCommand(program);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CliError) {
      log.error(err.message);
    } else {
      log.error("Erreur inattendue :");
      console.error(chalk.red(String((err as Error)?.stack ?? err)));
    }
    process.exit(1);
  }
}

main();
