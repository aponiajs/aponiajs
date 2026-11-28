import toolManifest from "../package.json" with { type: "json" };

/**
 * The AponiaJS release this package speaks for.
 *
 * Every publishable manifest in the workspace carries the same version, so this
 * package's own manifest names the release that produced the data a boot
 * publishes. It is what `/meta` reports as `framework` for an application no
 * boot produced, where there is no boot record to read the release from.
 */
export const aponiaVersion: string = toolManifest.version;
