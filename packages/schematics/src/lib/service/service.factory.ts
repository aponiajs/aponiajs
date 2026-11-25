import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream service template set. */
export const main = createSchematicFactory({ schematic: "service", nestByName: true });
