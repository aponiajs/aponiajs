import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  SchematicCollection,
  SchematicCollectionEntry,
  SchematicFactory,
  SchematicOptions,
  SchematicPlan,
} from "@aponiajs/schematics";

/** The collection a project reads when none is named. */
export const defaultCollection = "@aponiajs/schematics";

/** A resolved collection: the package root and the file it published. */
export interface ResolvedCollection {
  /** The package name or directory the caller named. */
  readonly name: string;
  /** The package root the collection's relative paths resolve against. */
  readonly root: string;
  /** The parsed collection. */
  readonly collection: SchematicCollection;
}

/**
 * Resolves a package's `collection.json`.
 *
 * A name is resolved from the project's own `node_modules` first, so a project
 * that installed a different collection uses that copy. A relative or absolute
 * path is accepted for a local collection. The default Aponia collection is
 * resolved from the CLI's own dependency tree last, which is what lets
 * `aponia generate` run in this workspace before a project is installed.
 *
 * @param projectRoot - The project the collection is resolved from.
 * @param name - The package name or directory.
 * @returns The package root and parsed collection.
 * @throws A plain `Error` naming the package when no collection resolves.
 */
export async function resolveCollection(
  projectRoot: string,
  name: string,
): Promise<ResolvedCollection> {
  const root = resolveCollectionRoot(projectRoot, name);
  if (root === undefined) {
    throw new Error(
      `Could not resolve the schematic collection "${name}". Install it, or pass a directory that contains collection.json.`,
    );
  }
  const file = Bun.file(join(root, "collection.json"));
  if (!(await file.exists())) {
    throw new Error(`The package "${name}" publishes no collection.json.`);
  }
  return {
    name,
    root,
    collection: (await file.json()) as SchematicCollection,
  };
}

function resolveCollectionRoot(projectRoot: string, name: string): string | undefined {
  if (isAbsolute(name) || name.startsWith(".")) {
    const root = resolve(projectRoot, name);
    return existsSync(join(root, "collection.json")) ? root : undefined;
  }

  const candidates = [
    tryResolve(`${name}/package.json`, projectRoot),
    join(projectRoot, "node_modules", name, "package.json"),
    tryResolve(`${name}/package.json`, import.meta.dir),
    ...(name === defaultCollection
      ? [join(import.meta.dir, "..", "..", "..", "schematics", "package.json")]
      : []),
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) {
      return dirname(candidate);
    }
  }
  return undefined;
}

function tryResolve(specifier: string, from: string): string | undefined {
  try {
    return Bun.resolveSync(specifier, from);
  } catch {
    return undefined;
  }
}

/**
 * Finds a schematic by name or alias in a resolved collection.
 *
 * @param resolved - The resolved collection.
 * @param schematic - The name or alias the caller used.
 * @returns The entry and its canonical name.
 * @throws A plain `Error` naming the package and the schematic.
 */
export function findSchematic(
  resolved: ResolvedCollection,
  schematic: string,
): { readonly name: string; readonly entry: SchematicCollectionEntry } {
  const direct = resolved.collection.schematics[schematic];
  if (direct !== undefined) {
    return { name: schematic, entry: direct };
  }
  for (const [name, entry] of Object.entries(resolved.collection.schematics)) {
    if (entry.aliases?.includes(schematic)) {
      return { name, entry };
    }
  }
  throw new Error(
    `The collection "${resolved.name}" has no schematic "${schematic}". Available schematics: ${Object.keys(
      resolved.collection.schematics,
    ).join(", ")}.`,
  );
}

/**
 * Runs one collection schematic and returns the files it plans.
 *
 * @param resolved - The resolved collection.
 * @param schematic - The entry to run.
 * @param options - The validated options.
 * @returns The files the factory planned.
 * @throws A plain `Error` when the factory path escapes the package or exports nothing callable.
 */
export async function runSchematic(
  resolved: ResolvedCollection,
  schematic: { readonly entry: SchematicCollectionEntry },
  options: SchematicOptions,
): Promise<SchematicPlan> {
  const [reference = "", exportName = "main"] = schematic.entry.factory.split("#", 2);
  const factoryPath = resolve(resolved.root, reference);
  if (factoryPath !== resolved.root && !factoryPath.startsWith(`${resolved.root}${sep}`)) {
    throw new Error(
      `The collection "${resolved.name}" names a factory outside the package: ${reference}.`,
    );
  }
  if (!(await Bun.file(factoryPath).exists())) {
    throw new Error(
      `The collection "${resolved.name}" names a factory that does not exist: ${reference}.`,
    );
  }

  const module = (await import(pathToFileURL(factoryPath).href)) as Record<string, unknown>;
  const factory = module[exportName];
  if (typeof factory !== "function") {
    throw new Error(
      `The collection "${resolved.name}" factory ${reference}#${exportName} does not export a function.`,
    );
  }
  return (factory as SchematicFactory)(options);
}

/**
 * Validates options against a schematic's JSON Schema.
 *
 * The supported subset is what the published schemas use: `type`, `required`,
 * `enum`, `default`, and nested `properties`.
 *
 * @param schema - The parsed schema.
 * @param options - The options to validate.
 * @returns The options with schema defaults applied.
 * @throws A plain `Error` naming the first property that fails.
 */
export function applySchematicSchema(
  schema: Readonly<Record<string, unknown>>,
  options: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && options[key] === undefined) {
      throw new Error(`The schematic requires "${key}".`);
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const resolved: Record<string, unknown> = { ...options };
  for (const [key, property] of Object.entries(properties)) {
    if (!isRecord(property)) {
      continue;
    }
    const value = resolved[key];
    if (value === undefined) {
      if (property.default !== undefined) {
        resolved[key] = property.default;
      }
      continue;
    }
    checkType(key, value, property);
  }
  return resolved;
}

function checkType(key: string, value: unknown, property: Readonly<Record<string, unknown>>): void {
  const expected = property.type;
  if (expected === "string" && typeof value !== "string") {
    throw new Error(`The schematic option "${key}" must be a string.`);
  }
  if (expected === "boolean" && typeof value !== "boolean") {
    throw new Error(`The schematic option "${key}" must be a boolean.`);
  }
  if (expected === "array" && !Array.isArray(value)) {
    throw new Error(`The schematic option "${key}" must be an array.`);
  }
  if (Array.isArray(property.enum) && !property.enum.includes(value)) {
    throw new Error(
      `The schematic option "${key}" must be one of: ${property.enum.map(String).join(", ")}.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a schematic's published schema.
 *
 * @param resolved - The resolved collection.
 * @param entry - The collection entry.
 * @returns The parsed schema, or `undefined` when the entry declares none.
 */
export async function readSchematicSchema(
  resolved: ResolvedCollection,
  entry: SchematicCollectionEntry,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  if (entry.schema === undefined) {
    return undefined;
  }
  const schemaPath = resolve(resolved.root, entry.schema);
  if (!(await Bun.file(schemaPath).exists())) {
    throw new Error(
      `The collection "${resolved.name}" names a schema that does not exist: ${entry.schema}.`,
    );
  }
  return (await Bun.file(schemaPath).json()) as Readonly<Record<string, unknown>>;
}

/** The project-relative path a resolved file is written to. */
export function toProjectPath(projectRoot: string, file: string): string {
  const path = relative(projectRoot, file);
  return path.startsWith("..") ? file : path;
}
