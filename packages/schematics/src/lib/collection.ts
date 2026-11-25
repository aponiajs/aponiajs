import { join } from "node:path";
import type { SchematicCollection, SchematicCollectionEntry } from "./schematic.types.ts";

/** The default collection package an Aponia project names. */
export const defaultCollectionPackage = "@aponiajs/schematics";

/** Reads and parses the collection a package publishes. */
export async function readCollection(packageRoot: string): Promise<SchematicCollection> {
  const file = Bun.file(join(packageRoot, "collection.json"));
  if (!(await file.exists())) {
    throw new Error(`No collection.json found in "${packageRoot}".`);
  }
  return (await file.json()) as SchematicCollection;
}

/** The schematic names a collection publishes. */
export function collectionSchematicNames(collection: SchematicCollection): readonly string[] {
  return Object.freeze(Object.keys(collection.schematics).toSorted());
}

/** Every alias a collection publishes, mapped to the schematic it names. */
export function collectionAliases(
  collection: SchematicCollection,
): Readonly<Record<string, string>> {
  const aliases: Record<string, string> = {};
  for (const [name, entry] of Object.entries(collection.schematics)) {
    for (const alias of entry.aliases ?? []) {
      aliases[alias] = name;
    }
  }
  return Object.freeze(aliases);
}

/** Resolves one schematic entry by its name or alias. */
export function resolveCollectionEntry(
  collection: SchematicCollection,
  name: string,
): { readonly name: string; readonly entry: SchematicCollectionEntry } | undefined {
  const direct = collection.schematics[name];
  if (direct !== undefined) {
    return { name, entry: direct };
  }
  const alias = collectionAliases(collection)[name];
  const entry = alias === undefined ? undefined : collection.schematics[alias];
  return alias === undefined || entry === undefined ? undefined : { name: alias, entry };
}

/** The file a collection entry's `factory` field names, split from its export. */
export function parseFactoryReference(reference: string): {
  readonly path: string;
  readonly exportName: string;
} {
  const [path = "", exportName = "main"] = reference.split("#", 2);
  return { path, exportName };
}
