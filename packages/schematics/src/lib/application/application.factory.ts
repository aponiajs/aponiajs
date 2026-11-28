import { createSchematicFactory } from "../schematic.factory.ts";

/** Renders the pinned upstream application template set. */
export const main = createSchematicFactory({
  schematic: "application",
  templateDirectory: (options) => {
    if (options.minimal === true) {
      if ((options.language ?? "ts") !== "ts") {
        throw new Error(
          "A minimal application is TypeScript only: JavaScript needs Babel and its own entry file to run decorators, so it would not stay one file.",
        );
      }
      if ((options.type ?? "esm") !== "esm") {
        throw new Error(
          'A minimal application is ESM only (type "esm"): generate a standard application to use CommonJS.',
        );
      }
      return "files/ts-minimal";
    }
    const language = options.language ?? "ts";
    return (options.type ?? "esm") === "esm" && language === "ts"
      ? "files/ts-esm"
      : `files/${language}`;
  },
});
