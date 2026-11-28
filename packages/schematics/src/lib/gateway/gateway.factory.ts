import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream gateway template set. */
export const main = createSchematicFactory({ schematic: "gateway", nestByName: true });
