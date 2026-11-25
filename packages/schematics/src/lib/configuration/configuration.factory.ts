import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream configuration template set. */
export const main = createSchematicFactory({
  schematic: "configuration",
  requiresName: false,
});
