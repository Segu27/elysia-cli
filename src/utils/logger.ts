import chalk from "chalk";

/** Petits wrappers de sortie colorée, centralisés pour rester cohérents. */
export const log = {
  info: (msg: string) => console.log(chalk.cyan("ℹ"), msg),
  success: (msg: string) => console.log(chalk.green("✔"), msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.error(chalk.red("✖"), msg),
  /** Affiche un fichier créé. */
  created: (path: string) =>
    console.log(`  ${chalk.green("+")} ${chalk.dim(path)}`),
  /** Affiche un fichier modifié (injection). */
  updated: (path: string) =>
    console.log(`  ${chalk.yellow("~")} ${chalk.dim(path)}`),
  /** Affiche un fichier ignoré (déjà présent). */
  skipped: (path: string) =>
    console.log(`  ${chalk.gray("=")} ${chalk.dim(path + " (existe déjà)")}`),
  title: (msg: string) => console.log("\n" + chalk.bold(msg)),
};

export class CliError extends Error {}
