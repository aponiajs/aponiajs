import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream library template set. */
export const main = createSchematicFactory({ schematic: "library", nestByName: true });
