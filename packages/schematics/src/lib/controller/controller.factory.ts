import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream controller template set. */
export const main = createSchematicFactory({ schematic: "controller", nestByName: true });
