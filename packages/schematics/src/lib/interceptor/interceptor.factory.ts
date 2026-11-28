import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream interceptor template set. */
export const main = createSchematicFactory({ schematic: "interceptor", nestByName: true });
