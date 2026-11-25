import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream pipe template set. */
export const main = createSchematicFactory({ schematic: "pipe", nestByName: true });
