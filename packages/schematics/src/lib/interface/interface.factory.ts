import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream interface template set, which ships no language split. */
export const main = createSchematicFactory({
  schematic: "interface",
  templateDirectory: () => "files",
  nestByName: true,
});
