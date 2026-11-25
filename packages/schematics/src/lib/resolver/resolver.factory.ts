import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream resolver template set. */
export const main = createSchematicFactory({ schematic: "resolver", nestByName: true });
