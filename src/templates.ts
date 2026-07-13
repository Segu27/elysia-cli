import type { NameSet } from "./utils/naming.js";

/**
 * Fonctions de génération de contenu de fichiers.
 * On garde des template strings simples plutôt que Handlebars : moins de deps,
 * typage complet, et facile à faire évoluer.
 */

/**
 * Controller = une instance Elysia (routes), nommée d'après le module.
 * Importe le Service (logique) et le Model (validation body/response).
 */
export function controllerTemplate(n: NameSet): string {
  return `import { Elysia, t } from "elysia";

import { ${n.pascal} } from "./${n.kebab}.service";
import { ${n.pascal}Model } from "./${n.kebab}.model";

export const ${n.camel} = new Elysia({ prefix: "/${n.kebabPlural}" })
  .get("/", () => ${n.pascal}.findAll())
  .get(
    "/:id",
    ({ params: { id } }) => ${n.pascal}.findOne(id),
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/",
    ({ body }) => ${n.pascal}.create(body),
    {
      body: ${n.pascal}Model.create,
      // response optionnelle : contractualise le type de retour
      response: { 200: ${n.pascal}Model.entity },
    },
  )
  .put(
    "/:id",
    ({ params: { id }, body }) => ${n.pascal}.update(id, body),
    { params: t.Object({ id: t.String() }), body: ${n.pascal}Model.update },
  )
  .delete(
    "/:id",
    ({ params: { id } }) => ${n.pascal}.remove(id),
    { params: t.Object({ id: t.String() }) },
  );
`;
}

/** Service = classe abstraite avec méthodes statiques (logique métier). */
export function serviceTemplate(n: NameSet): string {
  return `import type { ${n.pascal}Model } from "./${n.kebab}.model";

/**
 * Service ${n.pascal} — logique métier, indépendante d'une requête.
 * Classe abstraite + méthodes statiques (bonne pratique Elysia pour un
 * service sans état). Remplace le stub in-memory par ta couche data.
 */
export abstract class ${n.pascal} {
  static async findAll(): Promise<${n.pascal}Model["entity"][]> {
    return [];
  }

  static async findOne(id: string) {
    return { id, name: "" };
  }

  static async create(body: ${n.pascal}Model["create"]) {
    return { id: crypto.randomUUID(), ...body };
  }

  static async update(id: string, body: ${n.pascal}Model["update"]) {
    return { id, ...body };
  }

  static async remove(id: string) {
    return { id, deleted: true };
  }
}
`;
}

/** Model = objet de schémas t.* + type TS dérivé (source unique de vérité). */
export function modelTemplate(n: NameSet): string {
  return `// Model define the data structure and validation for the request and response
import { t, type UnwrapSchema } from "elysia";

export const ${n.pascal}Model = {
  entity: t.Object({
    id: t.String(),
    name: t.String(),
  }),
  create: t.Object({
    name: t.String({ minLength: 1 }),
  }),
  update: t.Partial(
    t.Object({
      name: t.String({ minLength: 1 }),
    }),
  ),
} as const;

// Optional, cast all model to TypeScript type
export type ${n.pascal}Model = {
  [K in keyof typeof ${n.pascal}Model]: UnwrapSchema<(typeof ${n.pascal}Model)[K]>;
};
`;
}

/** Barrel export du module. */
export function barrelTemplate(n: NameSet): string {
  return `export * from "./${n.kebab}.controller";
export * from "./${n.kebab}.service";
export * from "./${n.kebab}.model";
`;
}

/** Macro générique (`src/macros/<name>.macro.ts`). */
export function macroTemplate(n: NameSet): string {
  return `import { Elysia } from "elysia";

/**
 * Macro ${n.camel} — activable par route via \`{ ${n.camel}: true }\`.
 * \`resolve\` peut retourner des valeurs injectées dans le contexte des routes.
 */
export const ${n.camel}Macro = new Elysia({ name: "${n.kebab}.macro" }).macro({
  ${n.camel}: {
    resolve() {
      // TODO: logique de la macro (auth, permissions, contexte…)
      return {};
    },
  },
});
`;
}

/**
 * Macro `auth` liée à better-auth (`src/macros/auth.macro.ts`).
 * Monte le handler et expose `user`/`session` aux routes protégées.
 */
export function authMacroTemplate(): string {
  return `import { Elysia } from "elysia";
import { auth } from "../lib/auth";

/**
 * Plugin better-auth : monte le handler ET expose la macro \`auth\`.
 * Usage : \`.get("/me", ({ user }) => user, { auth: true })\`
 */
export const authMacro = new Elysia({ name: "better-auth" })
  .mount(auth.handler)
  .macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({ headers });
        if (!session) return status(401);

        return {
          user: session.user,
          session: session.session,
        };
      },
    },
  });
`;
}

/**
 * Module racine (`src/modules/index.ts`) — point d'agrégation des modules.
 * `generate module` y branche chaque controller. Accueille éventuellement la
 * route par défaut déplacée depuis l'app entry.
 */
export function modulesIndexTemplate(rootHandler?: string): string {
  const route = rootHandler ? `\n  .get("/", ${rootHandler})` : "";
  return `import { Elysia } from "elysia";

/**
 * Agrégat des modules de l'application. Les controllers sont branchés ici via
 * \`.use(...)\` par \`generate module\`.
 */
export const modules = new Elysia({ name: "modules" })${route};
`;
}

/**
 * Hooks de logging des requêtes, injectés directement dans la chaîne de l'app
 * entry (après `new Elysia()`). Nécessite l'import de `Logger`.
 */
export function loggerHooksSegment(): string {
  return `.onBeforeHandle((ctx) => {
    (ctx as any)._startTime = Date.now();
  })
  .onAfterResponse(({ request, set, server, ...ctx }) => {
    const status = set.status;
    const ip = server?.requestIP(request)?.address;
    const duration = Date.now() - ((ctx as any)._startTime ?? Date.now());
    Logger.app.request(request.method, request.url, status, ip, \`\${duration}ms\`);
  })`;
}

/**
 * Logger applicatif (chalk) — écrit dans le projet cible par `add logger`.
 * Nécessite \`chalk\` et \`elysia\` (déjà présent).
 */
export function loggerTemplate(): string {
  return `import chalk from "chalk";
import { StatusMap } from "elysia";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function messageParser(message: unknown): string {
  if (typeof message !== "string") return JSON.stringify(message);
  return message;
}

function formatMeta(meta?: object): string {
  if (!meta) return "";
  return " " + chalk.dim(JSON.stringify(meta));
}

function formatTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return \`\${pad(d.getHours())}:\${pad(d.getMinutes())}:\${pad(d.getSeconds())}\`;
}

const METHOD_COLORS: Record<string, (s: string) => string> = {
  GET: chalk.green,
  POST: chalk.blue,
  PUT: chalk.yellow,
  PATCH: chalk.magenta,
  DELETE: chalk.red,
};

function getMethodColor(method: string): (s: string) => string {
  return METHOD_COLORS[method] ?? chalk.white;
}

function getStatusColor(status: number | keyof StatusMap): (s: string) => string {
  const numericStatus = typeof status === "number" ? status : StatusMap[status];
  if (numericStatus < 300) return chalk.green;
  if (numericStatus < 400) return chalk.cyan;
  if (numericStatus < 500) return chalk.yellow;
  return chalk.red;
}

function createAppLogger(serviceName: string) {
  const time = () => chalk.dim.yellow.bold.underline(formatTime());
  const service = (c: (s: string) => string) => c(\`[\${serviceName}]\`);

  return {
    debug: (message: unknown, meta?: object) => {
      if (!shouldLog("debug")) return;
      console.log(
        \`[\${chalk.cyan("DBG")}] \${time()} \${service(chalk.cyan)} \${messageParser(message)}\${formatMeta(meta)}\`,
      );
    },
    info: (message: unknown, meta?: object) => {
      if (!shouldLog("info")) return;
      console.log(
        \`[\${chalk.green("INFO")}] \${time()} \${service(chalk.green)} \${messageParser(message)}\${formatMeta(meta)}\`,
      );
    },
    warn: (message: unknown, meta?: object) => {
      if (!shouldLog("warn")) return;
      console.log(
        \`[\${chalk.yellow("WARN")}] \${time()} \${service(chalk.yellow)} \${messageParser(message)}\${formatMeta(meta)}\`,
      );
    },
    error: (message: unknown, meta?: object) => {
      if (!shouldLog("error")) return;
      console.log(
        \`[\${chalk.red("ERR")}] \${time()} \${service(chalk.red)} \${messageParser(message)}\${formatMeta(meta)}\`,
      );
    },
    request: (
      method: string,
      url: string,
      status?: number | keyof StatusMap,
      ip: string = "",
      duration?: string,
      meta?: object,
    ) => {
      if (!shouldLog("info")) return;
      const methodColor = getMethodColor(method);
      const statusStr = status
        ? \` \${getStatusColor(status)(String(status))}\`
        : "";
      const durationStr = duration ? \` \${chalk.cyan(duration)}\` : "";
      console.log(
        \`[\${chalk.magenta("REQ")}] \${time()} \${service(chalk.magenta)} \${methodColor(method)} \${url}\${statusStr}\${durationStr} \${ip} \${formatMeta(meta)}\`,
      );
    },
  };
}

export const Logger = {
  app: createAppLogger("App"),
  auth: createAppLogger("Auth"),
  travel: createAppLogger("Travel"),
  db: createAppLogger("Database"),
  upload: createAppLogger("Upload"),
  of: createAppLogger,
};
`;
}

/**
 * Config better-auth (`src/lib/auth.ts`). Avec Prisma, l'adapter est branché ;
 * sinon il reste en commentaire (à activer après `add prisma`).
 */
export function authLibTemplate(
  withPrisma: boolean,
  prismaProvider = "postgresql",
): string {
  const header = withPrisma
    ? `import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "../db";`
    : `import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
// import { prismaAdapter } from "better-auth/adapters/prisma";
// import prisma from "../db";`;

  const database = withPrisma
    ? `  database: prismaAdapter(prisma, { provider: "${prismaProvider}" }),`
    : `  // database: prismaAdapter(prisma, { provider: "${prismaProvider}" }),`;

  return `${header}

/**
 * Instance better-auth. Handler monté via \`.mount(auth.handler)\` → routes sur
 * /api/auth. Le plugin openAPI() expose le schéma consommé par @elysiajs/openapi.
 */
export const auth = betterAuth({
${database}
  emailAndPassword: { enabled: true },
  plugins: [openAPI()],
});

// Extraction du schéma OpenAPI de better-auth pour @elysiajs/openapi.
let _schema: ReturnType<typeof auth.api.generateOpenAPISchema>;
const getSchema = async () => (_schema ??= auth.api.generateOpenAPISchema());

export const OpenAPI = {
  getPaths: (prefix = "/api/auth") =>
    getSchema().then(({ paths }) => {
      const reference: typeof paths = Object.create(null);
      for (const path of Object.keys(paths)) {
        const key = prefix + path;
        reference[key] = paths[path];
        for (const method of Object.keys(paths[path])) {
          const operation = (reference[key] as any)[method];
          operation.tags = ["Better Auth"];
        }
      }
      return reference;
    }) as Promise<any>,
  components: getSchema().then(({ components }) => components) as Promise<any>,
} as const;
`;
}

/**
 * Client Prisma singleton (`src/db/index.ts`).
 * Prisma 7 requiert un driver adapter, dépendant du provider choisi.
 */
export function prismaClientTemplate(adapter: {
  adapterImport: string;
  adapterPkg: string;
  adapterExpr: string;
}): string {
  return `import { ${adapter.adapterImport} } from "${adapter.adapterPkg}";
// Client généré vers un output custom (Prisma 7) — import depuis ce dossier,
// pas depuis "@prisma/client".
import { PrismaClient } from "../generated/prisma/client";

/**
 * Singleton PrismaClient — évite d'ouvrir plusieurs pools de connexions
 * (notamment en dev avec le hot-reload). Prisma 7 : la connexion passe par
 * un adapter, l'URL est lue depuis DATABASE_URL (.env.local).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = ${adapter.adapterExpr};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
`;
}

/**
 * Schéma Prisma (`prisma/schema.prisma`). Prisma 7 : plus d'\`url\` dans le
 * datasource (déplacée dans prisma.config.ts). Génère aussi les modèles de
 * validation Elysia via prismabox.
 */
export function prismaSchemaTemplate(prismaProvider = "postgresql"): string {
  return `generator client {
  provider = "prisma-client"
  output = "../src/generated/prisma"
}

generator prismabox {
  provider = "prismabox"
  typeboxImportDependencyName = "elysia"
  typeboxImportVariableName = "t"
  inputModel = true
  output = "../src/generated/prismabox"
}

datasource db {
  provider = "${prismaProvider}"
}
`;
}

/**
 * Config Prisma (`prisma.config.ts`). Prisma 7 : l'URL de connexion (utilisée
 * par Migrate) vit ici, chargée depuis .env.local.
 */
export function prismaConfigTemplate(): string {
  return `import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 charge .env par défaut ; on pointe explicitement sur .env.local.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
`;
}
