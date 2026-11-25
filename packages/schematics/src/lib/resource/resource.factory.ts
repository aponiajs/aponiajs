import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream resource template set. */
export const main = createSchematicFactory({
  schematic: "resource",
  nestByName: true,
  supportedLanguages: ["ts"],
  unsupportedLanguageMessage:
    'The "resource" schematic does not support JavaScript language (only TypeScript is supported).',
});
