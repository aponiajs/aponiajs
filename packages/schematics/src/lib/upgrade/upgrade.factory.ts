import type { SchematicFactory } from "../schematic.types.ts";

/**
 * Upgrades the Aponia packages to the current release channel.
 *
 * The CLI owns the manifest rewrite and the install, because both need the
 * workspace's own version resolution rather than a template render. The
 * collection still publishes a factory so `upgrade` and its `update` alias
 * resolve like every other schematic.
 */
export const main: SchematicFactory = () => ({
  files: [],
});
