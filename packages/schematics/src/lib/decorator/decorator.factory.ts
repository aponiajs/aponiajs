import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream decorator template set. */
export const main = createSchematicFactory({ schematic: "decorator", nestByName: true });
