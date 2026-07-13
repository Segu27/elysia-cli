import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { randomBytes } from "node:crypto";
import type { Command } from "commander";
import * as p from "@clack/prompts";
import { loadConfig, loadTsProject, type ElysiaCliConfig } from "../utils/project.js";
import {
  registerUse,
  appendChain,
  moduleSpecifierFrom,
  replaceConsoleWithLogger,
  patchOpenapiWithAuth,
} from "../utils/inject.js";
import { installDeps, run } from "../utils/pm.js";
import { ensureEnvVars } from "../utils/env.js";
import { ensureGitignore } from "../utils/gitignore.js";
import { ensureScripts } from "../utils/package-json.js";
import {
  DB_PROVIDERS,
  DB_PROVIDER_KEYS,
  detectPrismaProvider,
  type DbProvider,
} from "../utils/db.js";
import { log, CliError } from "../utils/logger.js";
import {
  loggerTemplate,
  loggerHooksSegment,
  authLibTemplate,
  authMacroTemplate,
  prismaClientTemplate,
  prismaSchemaTemplate,
  prismaConfigTemplate,
} from "../templates.js";

type PostInstall = () => void;

interface PresetOutcome {
  pkgs?: string[];
  devPkgs?: string[];
  postInstall?: PostInstall;
}

interface Preset {
  /** Dépendances de base (toujours installées). */
  pkgs?: string[];
  devPkgs?: string[];
  /** Scaffolding + injection. Async pour permettre des prompts. */
  apply: (config: ElysiaCliConfig) => Promise<PresetOutcome> | PresetOutcome | void;
}

export interface ApplyResult {
  pkgs: string[];
  devPkgs: string[];
  postInstall?: PostInstall;
}

/** Preset middleware simple : `.use(<expr>)` + import + dépendance. */
function usePreset(spec: {
  expr: string;
  importName: string;
  importFrom: string;
}): Preset {
  return {
    pkgs: [spec.importFrom],
    apply: (config) => {
      const project = loadTsProject();
      registerUse(
        project,
        { entry: config.appEntry, variable: config.appVariable },
        {
          useExpr: spec.expr,
          ensureImport: { names: [spec.importName], moduleSpecifier: spec.importFrom },
        },
      );
    },
  };
}

/** Prisma déjà présent dans le projet ? (schéma ou client généré). */
function hasPrisma(config: ElysiaCliConfig): boolean {
  return (
    existsSync(join(process.cwd(), "prisma", "schema.prisma")) ||
    existsSync(join(process.cwd(), config.srcDir, "db", "index.ts"))
  );
}

async function promptProvider(): Promise<string> {
  const answer = await p.select({
    message: "Provider de base de données ?",
    options: DB_PROVIDER_KEYS.map((k) => ({
      value: k,
      label: DB_PROVIDERS[k].label,
    })),
    initialValue: "postgresql",
  });
  if (p.isCancel(answer)) throw new CliError("Annulé.");
  return answer as string;
}

async function promptText(message: string, initial: string): Promise<string> {
  const answer = await p.text({ message, placeholder: initial, defaultValue: initial });
  if (p.isCancel(answer)) throw new CliError("Annulé.");
  return (answer as string) || initial;
}

async function promptPassword(message: string): Promise<string> {
  const answer = await p.password({ message });
  if (p.isCancel(answer)) throw new CliError("Annulé.");
  return (answer as string) ?? "";
}

/** Demande les composants de connexion et construit l'URL selon le provider. */
async function promptDatabaseUrl(provider: DbProvider): Promise<string> {
  if (provider.isFile || !provider.buildUrl) {
    return promptText("Chemin du fichier SQLite", provider.defaultUrl);
  }
  const host = await promptText("Host", "localhost");
  const port = await promptText("Port", provider.defaultPort ?? "");
  const user = await promptText("Utilisateur", "user");
  const password = await promptPassword("Mot de passe");
  const database = await promptText("Base de données", "mydb");
  return provider.buildUrl({ host, port, user, password, database });
}

/** better-auth déjà présent dans le projet ? */
function hasBetterAuth(config: ElysiaCliConfig): boolean {
  return existsSync(join(process.cwd(), config.srcDir, "lib", "auth.ts"));
}

// L'ordre compte : prisma avant better-auth, et better-auth avant openapi
// (pour intégrer le schéma auth dans la doc).
const PLUGINS: Record<string, Preset> = {
  cors: usePreset({ expr: "cors()", importName: "cors", importFrom: "@elysiajs/cors" }),
  jwt: usePreset({
    expr: 'jwt({ name: "jwt", secret: process.env.JWT_SECRET! })',
    importName: "jwt",
    importFrom: "@elysiajs/jwt",
  }),
  logger: {
    pkgs: ["chalk"],
    apply: (config) => {
      scaffoldFile(join(config.srcDir, "utils", "logger.ts"), loggerTemplate());
      const project = loadTsProject();
      const app = { entry: config.appEntry, variable: config.appVariable };
      const loggerPath = join(config.srcDir, "utils", "logger");
      appendChain(project, app, loggerHooksSegment(), {
        dedupe: "Logger.app.request",
        ensureImports: [
          {
            names: ["Logger"],
            moduleSpecifier: moduleSpecifierFrom(config.appEntry, loggerPath),
          },
        ],
      });
      replaceConsoleWithLogger(project, app, loggerPath);
    },
  },
  prisma: {
    pkgs: ["@prisma/client"],
    devPkgs: ["prisma", "prismabox", "dotenv"],
    apply: async (config) => {
      const provider = DB_PROVIDERS[await promptProvider()];
      const url = await promptDatabaseUrl(provider);

      scaffoldFile("prisma.config.ts", prismaConfigTemplate());
      scaffoldFile(
        join("prisma", "schema.prisma"),
        prismaSchemaTemplate(provider.prismaProvider),
      );
      scaffoldFile(join(config.srcDir, "db", "index.ts"), prismaClientTemplate(provider));
      ensureEnvVars({ DATABASE_URL: `"${url}"` });
      // Le client Prisma est généré (rebuild via prebuild/postInstall) : on l'ignore.
      ensureGitignore(["src/generated"]);
      // Ajoute build/start s'ils manquent, puis les hooks pre* correspondants :
      // prisma generate avant le build, prisma migrate deploy avant le start.
      ensureScripts({
        build: `bun build ${config.appEntry} --target bun --outdir dist`,
        start: `bun ${config.appEntry}`,
        prebuild: "prisma generate",
        prestart: "prisma migrate deploy",
      });

      return {
        pkgs: [provider.adapterPkg, ...provider.driverPkgs],
        postInstall: () => {
          run("prisma generate", "bunx", ["prisma", "generate"]);
        },
      };
    },
  },
  "better-auth": {
    pkgs: ["better-auth"],
    apply: async (config) => {
      const withPrisma = hasPrisma(config);
      const provider = detectPrismaProvider() ?? "postgresql";

      scaffoldFile(
        join(config.srcDir, "lib", "auth.ts"),
        authLibTemplate(withPrisma, provider),
      );
      // Macro `auth` : monte le handler + expose user/session aux routes.
      scaffoldFile(
        join(config.srcDir, "macros", "auth.macro.ts"),
        authMacroTemplate(),
      );

      const project = loadTsProject();
      registerUse(
        project,
        { entry: config.appEntry, variable: config.appVariable },
        {
          useExpr: "authMacro",
          ensureImport: {
            names: ["authMacro"],
            moduleSpecifier: moduleSpecifierFrom(
              config.appEntry,
              join(config.srcDir, "macros", "auth.macro"),
            ),
          },
        },
      );

      // Si un openapi a déjà été injecté, on le re-patche avec la doc auth.
      patchOpenapiWithAuth(
        project,
        config.appEntry,
        join(config.srcDir, "lib", "auth"),
      );

      const baseUrl = await promptText(
        "URL de l'app (BETTER_AUTH_URL)",
        "http://localhost:3000",
      );
      ensureEnvVars({
        BETTER_AUTH_SECRET: `"${randomBytes(32).toString("hex")}"`,
        BETTER_AUTH_URL: `"${baseUrl}"`,
      });

      log.info("better-auth monté sur /api/auth.");

      if (!withPrisma) return {};
      return {
        postInstall: () => {
          // Le client Prisma (output custom) doit exister avant que
          // `better-auth generate` ne lise src/db.
          run("prisma generate", "bunx", ["prisma", "generate"]);
          const generated = run("better-auth generate", "bunx", [
            "@better-auth/cli",
            "generate",
            "--y",
          ]);
          if (generated) {
            run("prisma migrate", "bunx", [
              "prisma",
              "migrate",
              "dev",
              "--name",
              "add-auth",
            ]);
          }
        },
      };
    },
  },
  openapi: {
    pkgs: ["@elysiajs/openapi"],
    apply: (config) => {
      const project = loadTsProject();
      const app = { entry: config.appEntry, variable: config.appVariable };
      const withAuth = hasBetterAuth(config);

      // Avec better-auth : intègre le schéma auth dans la doc OpenAPI.
      const expr = withAuth
        ? "openapi({ enabled : process.env.NODE_ENV !== \"production\", documentation: { components: await OpenAPI.components, paths: await OpenAPI.getPaths() } })"
        : "openapi({ enabled : process.env.NODE_ENV !== \"production\" })";

      const ensureImports = [
        { names: ["openapi"], moduleSpecifier: "@elysiajs/openapi" },
      ];
      if (withAuth) {
        ensureImports.push({
          names: ["OpenAPI"],
          moduleSpecifier: moduleSpecifierFrom(
            config.appEntry,
            join(config.srcDir, "lib", "auth"),
          ),
        });
      }

      appendChain(project, app, `.use(${expr})`, {
        dedupe: "openapi(",
        ensureImports,
      });
    },
  },
};

export const PLUGIN_KEYS = Object.keys(PLUGINS);

/** Applique un preset. N'installe PAS (l'appelant regroupe deps + post-install). */
export async function applyPlugin(
  key: string,
  config: ElysiaCliConfig,
): Promise<ApplyResult> {
  const preset = PLUGINS[key];
  if (!preset) {
    throw new CliError(
      `Plugin inconnu "${key}". Disponibles : ${PLUGIN_KEYS.join(", ")}.`,
    );
  }
  const res: PresetOutcome = (await preset.apply(config)) ?? {};
  return {
    pkgs: [...(preset.pkgs ?? []), ...(res.pkgs ?? [])],
    devPkgs: [...(preset.devPkgs ?? []), ...(res.devPkgs ?? [])],
    postInstall: res.postInstall,
  };
}

function scaffoldFile(relPath: string, content: string): void {
  const target = join(process.cwd(), relPath);
  if (existsSync(target)) {
    log.skipped(relPath);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  log.created(relative(process.cwd(), target));
}

export function registerAddCommand(program: Command) {
  program
    .command("add")
    .description(`Ajoute un plugin/preset (${PLUGIN_KEYS.join(", ")})`)
    .argument("[plugin]", PLUGIN_KEYS.join(" | "))
    .option("--no-install", "ne pas installer ni exécuter les post-install")
    .action(async (plugin?: string, opts?: { install: boolean }) => {
      let key = plugin;
      if (!key) {
        const answer = await p.select({
          message: "Quel plugin ajouter ?",
          options: PLUGIN_KEYS.map((v) => ({ value: v, label: v })),
        });
        if (p.isCancel(answer)) throw new CliError("Annulé.");
        key = answer as string;
      }

      const config = loadConfig();
      const { pkgs, devPkgs, postInstall } = await applyPlugin(key, config);

      if (opts?.install ?? true) {
        installDeps(pkgs);
        installDeps(devPkgs, { dev: true });
        postInstall?.();
      } else {
        if (pkgs.length) log.info(`À installer : bun add ${pkgs.join(" ")}`);
        if (devPkgs.length) log.info(`À installer : bun add -d ${devPkgs.join(" ")}`);
        if (postInstall) log.info("Étapes post-install à lancer manuellement.");
      }

      log.success(`Plugin ${key} ajouté.`);
    });
}
