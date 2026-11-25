import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream middleware template set. */
export const main = createSchematicFactory({ schematic: "middleware", nestByName: true });
