import platformManifest from "../package.json" with { type: "json" };

/**
 * The version of this package.
 *
 * A generated invoker artifact records the release that produced it, and
 * bootstrap refuses one that disagrees, so this has to be the running package's
 * own version rather than a constant somebody keeps in step by hand.
 */
export const aponiaVersion = platformManifest.version;
