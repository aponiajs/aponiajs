import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream guard template set. */
export const main = createSchematicFactory({ schematic: "guard", nestByName: true });
