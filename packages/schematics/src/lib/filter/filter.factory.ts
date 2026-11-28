import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream filter template set. */
export const main = createSchematicFactory({ schematic: "filter", nestByName: true });
