import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream module template set. */
export const main = createSchematicFactory({ schematic: "module", nestByName: true });
