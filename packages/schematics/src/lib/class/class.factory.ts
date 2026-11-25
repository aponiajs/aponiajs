import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream class template set. */
export const main = createSchematicFactory({ schematic: "class", nestByName: true });
