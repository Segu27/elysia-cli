import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DbCredentials {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

/** Description d'un provider de base pour Prisma 7 (driver adapter requis). */
export interface DbProvider {
  key: string;
  label: string;
  /** Valeur du datasource `provider` dans schema.prisma. */
  prismaProvider: string;
  /** Package de l'adapter Prisma. */
  adapterPkg: string;
  /** Nom de la classe adapter à importer. */
  adapterImport: string;
  /** Expression d'instanciation de l'adapter. */
  adapterExpr: string;
  /** Driver(s) natif(s) à installer. */
  driverPkgs: string[];
  /** Base fichier (SQLite) : pas de host/port/credentials. */
  isFile: boolean;
  /** Port par défaut (bases serveur). */
  defaultPort?: string;
  /** URL par défaut (SQLite : chemin du fichier). */
  defaultUrl: string;
  /** Construit l'URL de connexion à partir des composants (bases serveur). */
  buildUrl?: (c: DbCredentials) => string;
}

export const DB_PROVIDERS: Record<string, DbProvider> = {
  postgresql: {
    key: "postgresql",
    label: "PostgreSQL",
    prismaProvider: "postgresql",
    adapterPkg: "@prisma/adapter-pg",
    adapterImport: "PrismaPg",
    adapterExpr: "new PrismaPg({ connectionString: process.env.DATABASE_URL! })",
    driverPkgs: ["pg"],
    isFile: false,
    defaultPort: "5432",
    defaultUrl: "postgresql://user:password@localhost:5432/mydb?schema=public",
    buildUrl: (c) =>
      `postgresql://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}?schema=public`,
  },
  mysql: {
    key: "mysql",
    label: "MySQL / MariaDB",
    prismaProvider: "mysql",
    adapterPkg: "@prisma/adapter-mariadb",
    adapterImport: "PrismaMariaDb",
    // Le driver mariadb accepte une URI de connexion.
    adapterExpr: "new PrismaMariaDb(process.env.DATABASE_URL!)",
    driverPkgs: ["mariadb"],
    isFile: false,
    defaultPort: "3306",
    defaultUrl: "mysql://user:password@localhost:3306/mydb",
    buildUrl: (c) =>
      `mysql://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`,
  },
  sqlite: {
    key: "sqlite",
    label: "SQLite",
    prismaProvider: "sqlite",
    adapterPkg: "@prisma/adapter-better-sqlite3",
    adapterImport: "PrismaBetterSqlite3",
    adapterExpr:
      'new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" })',
    driverPkgs: ["better-sqlite3"],
    isFile: true,
    defaultUrl: "file:./dev.db",
  },
};

export const DB_PROVIDER_KEYS = Object.keys(DB_PROVIDERS);

/** Lit le provider déclaré dans prisma/schema.prisma, si présent. */
export function detectPrismaProvider(): string | null {
  const schema = join(process.cwd(), "prisma", "schema.prisma");
  if (!existsSync(schema)) return null;
  const match = readFileSync(schema, "utf8").match(
    /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/,
  );
  return match?.[1] ?? null;
}
