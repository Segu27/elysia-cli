/**
 * Helpers de casse pour dériver les différentes formes d'un nom de module.
 * Ex: "user-profile" ->
 *   kebab:  user-profile
 *   pascal: UserProfile
 *   camel:  userProfile
 *   plural: userProfiles
 */

import { CliError } from "./logger.js";

/**
 * Noms autorisés : commence par une lettre, puis lettres/chiffres/. _ -.
 * Bloque les caractères qui permettraient une injection shell (le nom passe
 * dans `bun create elysia <name>`) ou un path traversal (dossiers de modules).
 */
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]*$/;

export function nameError(input: string): string | undefined {
  if (!input.trim()) return "Nom requis";
  if (input.length > 100) return "Nom trop long (max 100).";
  if (!NAME_RE.test(input)) {
    return "Autorisé : lettres, chiffres, . _ - (doit commencer par une lettre).";
  }
  return undefined;
}

/** Lève si le nom est invalide (à utiliser sur les noms passés en argument). */
export function assertValidName(input: string): void {
  const err = nameError(input);
  if (err) throw new CliError(`Nom invalide "${input}" : ${err}`);
}

function splitWords(input: string): string[] {
  return input
    // sépare camelCase / PascalCase
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // remplace séparateurs par des espaces
    .replace(/[-_/\s]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

export function toKebab(input: string): string {
  return splitWords(input).join("-");
}

export function toPascal(input: string): string {
  return splitWords(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function toCamel(input: string): string {
  const pascal = toPascal(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Pluriel naïf en anglais — suffisant pour les chemins de route. */
export function toPlural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.replace(/y$/i, "ies");
  if (/(s|sh|ch|x|z)$/i.test(word)) return word + "es";
  return word + "s";
}

export interface NameSet {
  raw: string;
  kebab: string;
  pascal: string;
  camel: string;
  camelPlural: string;
  kebabPlural: string;
}

export function buildNames(input: string): NameSet {
  const kebab = toKebab(input);
  const camel = toCamel(input);
  return {
    raw: input,
    kebab,
    pascal: toPascal(input),
    camel,
    camelPlural: toPlural(camel),
    kebabPlural: toPlural(kebab),
  };
}
