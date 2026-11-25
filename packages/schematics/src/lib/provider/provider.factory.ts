import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream provider template set. */
export const main = createSchematicFactory({ schematic: "provider", nestByName: true });
