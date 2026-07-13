import { existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import {
  SyntaxKind,
  type Project,
  type SourceFile,
  type NewExpression,
  type PropertyAccessExpression,
} from "ts-morph";
import { log } from "./logger.js";

/** Cible d'injection : un fichier + le nom de la variable de l'instance Elysia. */
export interface InjectTarget {
  entry: string;
  variable: string;
}

interface ImportSpec {
  names: string[];
  moduleSpecifier: string;
}

/**
 * Greffe un maillon de chaîne (`segment`, commençant par `.`) juste après
 * `new Elysia(...)`. AST-based (ts-morph), robuste au formatage et idempotent
 * via `dedupe` (sous-chaîne dont la présence signale un no-op).
 */
export function appendChain(
  project: Project,
  target: InjectTarget,
  segment: string,
  opts: { dedupe?: string; ensureImports?: ImportSpec[] } = {},
): boolean {
  const source = openEntry(project, target.entry);
  if (!source) return false;

  const elysiaNew = findElysiaInstance(source, target.variable);
  if (!elysiaNew) {
    log.warn(
      `Aucune instance \`new Elysia()\` (variable \`${target.variable}\`) dans ` +
        `${target.entry}. Segment non injecté.`,
    );
    return false;
  }

  const scope =
    elysiaNew.getFirstAncestorByKind(SyntaxKind.VariableStatement) ??
    elysiaNew.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  const marker = opts.dedupe ?? segment;
  if ((scope ?? source).getText().includes(marker)) {
    log.skipped(`${target.entry} (déjà présent)`);
    return false;
  }

  elysiaNew.replaceWithText(`${elysiaNew.getText()}\n  ${segment}`);
  for (const spec of opts.ensureImports ?? []) ensureImport(source, spec);

  source.saveSync();
  log.updated(target.entry);
  return true;
}

/** Raccourci : injecte `.use(<useExpr>)`. */
export function registerUse(
  project: Project,
  target: InjectTarget,
  opts: { useExpr: string; ensureImport?: ImportSpec },
): boolean {
  return appendChain(project, target, `.use(${opts.useExpr})`, {
    dedupe: `.use(${opts.useExpr})`,
    ensureImports: opts.ensureImport ? [opts.ensureImport] : undefined,
  });
}

/**
 * Ré-écrit un appel `openapi()` déjà présent dans l'app entry pour y injecter
 * la doc better-auth, et garantit l'import de `OpenAPI`. No-op si aucun appel
 * `openapi(...)` n'est trouvé, ou s'il est déjà intégré.
 */
export function patchOpenapiWithAuth(
  project: Project,
  appEntry: string,
  authImportPath: string,
): boolean {
  const source = openEntry(project, appEntry);
  if (!source) return false;

  // Déjà intégré.
  if (source.getText().includes("OpenAPI.getPaths")) return false;

  const call = source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((c) => c.getExpression().getText() === "openapi");
  if (!call) return false;

  call.replaceWithText(
    "openapi({ enabled : process.env.NODE_ENV !== \"production\", documentation: { components: await OpenAPI.components, " +
      "paths: await OpenAPI.getPaths() } })",
  );
  ensureImport(source, {
    names: ["OpenAPI"],
    moduleSpecifier: moduleSpecifierFrom(appEntry, authImportPath),
  });

  source.saveSync();
  log.updated(`${appEntry} (openapi ↔ better-auth intégré)`);
  return true;
}

/**
 * Retire la route racine par défaut (`.get("/", ...)`) de la cible et renvoie
 * le texte du handler pour le replacer ailleurs. `null` si absente.
 */
export function removeRootRoute(
  project: Project,
  target: InjectTarget,
): string | null {
  const source = openEntry(project, target.entry);
  if (!source) return null;

  const getCall = source
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
      if ((expr as PropertyAccessExpression).getName() !== "get") return false;
      const first = call.getArguments()[0];
      if (!first || first.getKind() !== SyntaxKind.StringLiteral) return false;
      return first.getText().replace(/['"]/g, "") === "/";
    });

  if (!getCall) return null;

  const handler = getCall.getArguments()[1]?.getText() ?? '() => "Hello Elysia"';
  const objText = (getCall.getExpression() as PropertyAccessExpression)
    .getExpression()
    .getText();
  getCall.replaceWithText(objText);

  source.saveSync();
  log.updated(`${target.entry} (route racine déplacée)`);
  return handler;
}

const CONSOLE_MAP: Record<string, string> = {
  log: "Logger.app.info",
  info: "Logger.app.info",
  debug: "Logger.app.debug",
  warn: "Logger.app.warn",
  error: "Logger.app.error",
};

/** Remplace les `console.*` de la cible par le Logger, et garantit son import. */
export function replaceConsoleWithLogger(
  project: Project,
  target: InjectTarget,
  loggerPath: string,
): number {
  const source = openEntry(project, target.entry);
  if (!source) return 0;

  let changed = 0;
  for (;;) {
    const pae = source
      .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .find(
        (pa) =>
          pa.getExpression().getText() === "console" && pa.getName() in CONSOLE_MAP,
      );
    if (!pae) break;
    pae.replaceWithText(CONSOLE_MAP[pae.getName()]);
    changed++;
    if (changed > 200) break; // garde-fou
  }

  if (changed > 0) {
    ensureImport(source, {
      names: ["Logger"],
      moduleSpecifier: moduleSpecifierFrom(target.entry, loggerPath),
    });
    source.saveSync();
    log.updated(`${target.entry} (console.* → Logger ×${changed})`);
  }
  return changed;
}

/** Specifier d'import relatif depuis `fromEntry` vers un fichier cible. */
export function moduleSpecifierFrom(fromEntry: string, targetPath: string): string {
  const fromAbs = resolve(process.cwd(), fromEntry);
  const rel = relative(dirname(fromAbs), resolve(process.cwd(), targetPath))
    .replace(/\\/g, "/")
    .replace(/\.ts$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

// ---------------------------------------------------------------------------

function openEntry(project: Project, entry: string): SourceFile | null {
  const abs = resolve(process.cwd(), entry);
  if (!existsSync(abs)) {
    log.warn(`Fichier cible introuvable (${entry}) — injection ignorée.`);
    return null;
  }
  return (
    project.addSourceFileAtPathIfExists(abs) ?? project.addSourceFileAtPath(abs)
  );
}

function ensureImport(source: SourceFile, spec: ImportSpec): void {
  const existing = source
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === spec.moduleSpecifier);
  if (!existing) {
    source.addImportDeclaration({
      moduleSpecifier: spec.moduleSpecifier,
      namedImports: spec.names,
    });
    return;
  }
  const present = new Set(existing.getNamedImports().map((n) => n.getName()));
  for (const name of spec.names) {
    if (!present.has(name)) existing.addNamedImport(name);
  }
}

function findElysiaInstance(
  source: SourceFile,
  variable: string,
): NewExpression | undefined {
  const decl = source.getVariableDeclaration(variable);
  if (decl) {
    const fromDecl = decl
      .getDescendantsOfKind(SyntaxKind.NewExpression)
      .find(isElysia);
    if (fromDecl) return fromDecl;
  }
  return source.getDescendantsOfKind(SyntaxKind.NewExpression).find(isElysia);
}

function isElysia(node: NewExpression): boolean {
  return node.getExpression().getText() === "Elysia";
}
