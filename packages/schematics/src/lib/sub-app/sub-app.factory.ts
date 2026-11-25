import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream sub-application template set. */
export const main = createSchematicFactory({ schematic: "sub-app", nestByName: true });
