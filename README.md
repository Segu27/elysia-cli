# @apc/elysia-cli

CLI de scaffolding pour projets **ElysiaJS**. Génère des modules (controller + service + model + plugin) suivant les bonnes pratiques Elysia, et **branche automatiquement** le plugin dans ton application via manipulation d'AST (ts-morph).

## Stack

- **Bun** — runtime (exécute le TypeScript directement, pas de build en dev)
- **commander** — parsing des commandes
- **@clack/prompts** — prompts interactifs
- **chalk** — sortie colorée
- **ts-morph** — lecture/écriture de l'AST TypeScript (injection du `.use()`)

## Installation (dev)

```bash
bun install
bun run dev -- --help       # exécute src/index.ts directement (aucun build)
```

Pour l'utiliser comme binaire global pendant le dev :

```bash
bun link                    # dans ce package
cd ../mon-api-test
bun link @apc/elysia-cli    # dans le projet cible
elysia-cli --help
```

Le `bin` pointe sur `src/index.ts` (shebang `#!/usr/bin/env bun`) : Bun lit le TS, donc rien à compiler pour l'installer. Un `bun install` du package suffit.

## Build standalone (distribution)

```bash
bun run build               # bun build --compile -> dist/elysia-cli
./dist/elysia-cli --help    # exécutable autonome, sans Bun ni Node
```

## Utilisation sans cloner le dépôt

### Via npm (recommandé)

Après publication sur npm (`bun publish` / `npm publish` — le package est `@apc/elysia-cli`), on peut l'exécuter sans installation :

```bash
bunx @apc/elysia-cli init mon-api
bunx @apc/elysia-cli add prisma
```

`bunx` résout le **nom du package** (pas le nom du binaire), d'où `@apc/elysia-cli`. Les dépendances sont installées automatiquement au premier run puis mises en cache.

### Via GitHub (sans publier sur npm)

Bun sait installer depuis un dépôt Git. En dépendance de projet :

```bash
bun add github:<owner>/<repo>        # ajoute @apc/elysia-cli au projet
bunx elysia-cli init mon-api         # le binaire local est alors résolu
```

Ou en global :

```bash
bun add -g github:<owner>/<repo>
elysia-cli init mon-api
```

Comme le `bin` pointe sur `src/index.ts` (shebang `#!/usr/bin/env bun`), aucune étape de build n'est requise à l'installation — Bun exécute le TypeScript directement. Assure-toi que `files` inclut `src` (c'est le cas) pour que la source soit bien livrée.

> Note : `bunx github:<owner>/<repo>` en une commande n'est pas garanti — passe par `bun add` (projet ou global) pour la voie GitHub. Pour un `bunx <nom>` direct, publie sur npm.

## Commandes

```bash
elysia-cli generate module <name>     # alias: g module
elysia-cli generate service <name>
elysia-cli generate model <name>
elysia-cli macro <name>               # génère src/macros/<name>.macro.ts + .use()
elysia-cli add <plugin>               # cors | openapi | jwt | logger | better-auth | prisma
elysia-cli init <project-name>        # `bun create elysia` + couche elysia-cli
```

`add` installe automatiquement les dépendances (`bun add`, désactivable avec `--no-install`) :

- `cors`, `jwt` — branchés par `.use(...)` dans l'app entry.
- `openapi` — branché **uniquement hors production** (`NODE_ENV !== "production"`). Si **better-auth** est présent, le schéma OpenAPI de better-auth est intégré à la doc (`documentation.components` / `documentation.paths`). L'intégration marche dans les deux sens : si tu ajoutes `openapi` puis `better-auth`, ce dernier **re-patche** l'appel `openapi()` existant pour y injecter la doc auth.
- `logger` — scaffolde le logger applicatif (chalk) dans `src/utils/logger.ts`, injecte les hooks `onBeforeHandle`/`onAfterResponse` **directement dans la chaîne** de `src/index.ts`, et remplace les `console.*` par le `Logger`.
- `prisma` — Prisma 7. **Demande le provider** (PostgreSQL / MySQL-MariaDB / SQLite) et l'**URL de connexion**, puis scaffolde le client singleton avec le bon driver adapter (`src/db/index.ts`), `prisma/schema.prisma` (provider choisi, sans `url`, + générateur **prismabox** pour les modèles de validation Elysia), `prisma.config.ts` (URL pour Migrate), et ajoute `DATABASE_URL` à `.env.local`. Le client est généré vers un **output custom** (`src/generated/prisma`, Prisma 7) et importé depuis `../generated/prisma/client` dans `src/db/index.ts` — jamais depuis `@prisma/client`. Le dossier `src/generated` est git-ignoré (régénéré via `prebuild`/post-install). `prisma generate` est lancé après install. Ajoute aussi au `package.json` (sans écraser l'existant) les scripts `build`/`start` s'ils manquent, plus `prebuild` (`prisma generate`) et `prestart` (`prisma migrate deploy`). Les paquets (`@prisma/adapter-*`, driver natif) dépendent du provider.
- `better-auth` — scaffolde `src/lib/auth.ts` **et une macro `auth`** (`src/macros/auth.macro.ts`) qui monte le handler (routes sur `/api/auth`) et expose `user`/`session` aux routes protégées via `{ auth: true }` ; branché par `.use(authMacro)`. **Demande `BETTER_AUTH_URL`** et ajoute `BETTER_AUTH_SECRET` (généré) + `BETTER_AUTH_URL` à `.env.local`. **Si Prisma est présent** (ou ajouté en même temps), l'adapter Prisma est câblé avec le provider détecté depuis le schéma, et les migrations auth sont générées puis appliquées (`@better-auth/cli generate` + `prisma migrate`).

`generate module` branche chaque controller dans l'agrégateur `src/modules/index.ts` (créé au besoin, avec `.use(modules)` dans l'app entry), et non plus directement dans `src/index.ts`.

`init` déplace la route racine par défaut dans `src/modules/index.ts` et propose de sélectionner des plugins à ajouter tout de suite (install auto).

Exemple :

```bash
elysia-cli g module user
```

Génère :

```
src/modules/user/
  user.controller.ts   # instance Elysia `user` (routes, body/response = UserModel)
  user.service.ts      # classe abstraite `User` (logique métier)
  user.model.ts        # objet de schémas `UserModel` (t.*) + type TS dérivé
  index.ts             # barrel export
```

Le controller s'exporte sous le nom du module (`export const user = …`), le service est une classe `User`, et le model est un objet de schémas (`UserModel.create`, `UserModel.entity`, `UserModel.update`) avec un type TypeScript dérivé — comme dans la doc Elysia. Le controller est ensuite branché dans l'agrégateur `src/modules/index.ts` via `.use(user)`.

## Configuration

Optionnel — `elysia-cli.config.json` à la racine du projet cible :

```json
{
  "srcDir": "src",
  "modulesDir": "src/modules",
  "appEntry": "src/index.ts",
  "appVariable": "app"
}
```

## Structure du package

```
src/
  index.ts              # entrée commander
  commands/
    generate.ts         # generate module/service/model
    add.ts              # add <plugin>
    init.ts             # init <project>
  utils/
    logger.ts           # wrappers chalk + clack
    naming.ts           # helpers de casse (pascal, camel, kebab)
    project.ts          # chargement du Project ts-morph + config
    inject.ts           # injection du .use() dans l'app
  templates.ts          # fonctions de génération de contenu
```

> Note : `tsup.config.ts` n'est plus utilisé (build géré par `bun build --compile`) et peut être supprimé.

## Étendre

Ajoute un générateur : nouvelle fonction dans `templates.ts` + branche-la dans `commands/generate.ts`. Pour un nouveau type d'injection, réutilise `utils/inject.ts` (basé sur ts-morph, donc robuste aux reformats).
