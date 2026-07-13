# @apc-projects/elysia-cli

[![npm](https://img.shields.io/npm/v/@apc-projects/elysia-cli.svg)](https://www.npmjs.com/package/@apc-projects/elysia-cli)
[![license](https://img.shields.io/npm/l/@apc-projects/elysia-cli.svg)](./LICENSE)

CLI de scaffolding pour projets **ElysiaJS**. Génère modules, services, models et macros, et branche automatiquement les plugins dans l'application via manipulation d'AST (ts-morph).

## Prérequis

Bun — le CLI s'exécute avec Bun ; Node / `npx` n'est pas supporté.

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Installation

```bash
# via npm
bunx @apc-projects/elysia-cli init mon-api

# ou depuis GitHub, en global
bun add -g github:<owner>/elysia-cli
elysia-cli init mon-api
```

## Commandes

```bash
elysia-cli init <project>           # bun create elysia + structure elysia-cli
elysia-cli generate module <name>   # alias : g
elysia-cli generate service <name>
elysia-cli generate model <name>
elysia-cli macro <name>             # génère une macro + .use()
elysia-cli add <plugin>             # cors | openapi | jwt | logger | better-auth | prisma
```

### Plugins (`add`)

Les dépendances sont installées automatiquement (`--no-install` pour désactiver).

| Plugin | Effet |
| --- | --- |
| `cors`, `jwt` | Branchés dans l'app via `.use(...)`. |
| `openapi` | Monté hors production uniquement. Intègre le schéma OpenAPI de better-auth s'il est présent. |
| `logger` | Logger applicatif (chalk) dans `src/utils/logger.ts`, hooks de logging des requêtes, et bascule des `console.*` vers `Logger`. |
| `prisma` | Prisma 7 : client singleton avec driver adapter, `schema.prisma` (+ générateur prismabox), `prisma.config.ts`, `DATABASE_URL` dans `.env.local`, scripts `prebuild`/`prestart`. Provider au choix (PostgreSQL / MySQL-MariaDB / SQLite). |
| `better-auth` | `src/lib/auth.ts` + macro `auth` (`.use(authMacro)`, routes sur `/api/auth`), secret et URL dans `.env.local`. Câble l'adapter Prisma et les migrations si Prisma est présent. |

## Structure générée

`generate module user` crée un module feature-based, branché dans l'agrégateur `src/modules/index.ts` :

```
src/modules/user/
  user.controller.ts   # instance Elysia « user »
  user.service.ts      # classe « User »
  user.model.ts        # schémas « UserModel » + type TS dérivé
  index.ts             # barrel export
```

Un projet complet (`init` + `prisma`, `better-auth`, `logger`, `openapi`) ressemble à :

```
mon-api/
  prisma/schema.prisma
  prisma.config.ts
  src/
    index.ts               # app Elysia (hooks logger, .use(modules), .use(authMacro)…)
    modules/index.ts       # agrégateur des modules
    lib/auth.ts            # instance better-auth
    macros/auth.macro.ts   # macro « auth »
    db/index.ts            # client Prisma
    utils/logger.ts
  .env.local               # DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL
  elysia-cli.config.json
```

## Configuration

Optionnel — `elysia-cli.config.json` à la racine du projet cible :

```json
{
  "srcDir": "src",
  "modulesDir": "src/modules",
  "appEntry": "src/index.ts",
  "appVariable": "app",
  "modulesEntry": "src/modules/index.ts",
  "modulesVariable": "modules"
}
```

## Développement

```bash
bun install
bun run dev -- --help    # exécute src/index.ts
bun run build            # binaire standalone -> dist/elysia-cli
```

## Licence

[MIT](./LICENSE) © Segu27
