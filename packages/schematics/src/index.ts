export {
  createSchematicFactory,
  type SchematicFactoryDefinition,
} from "./lib/schematic.factory.ts";
export type {
  SchematicCollection,
  SchematicCollectionEntry,
  SchematicFactory,
  SchematicFile,
  SchematicOptions,
  SchematicPlan,
} from "./lib/schematic.types.ts";
export {
  collectionAliases,
  collectionSchematicNames,
  defaultCollectionPackage,
  parseFactoryReference,
  readCollection,
  resolveCollectionEntry,
} from "./lib/collection.ts";
