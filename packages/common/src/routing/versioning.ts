const versionMetadataKey = Symbol.for("aponia.version.metadata");

/**
 * The version marker that keeps a route out of every version prefix.
 *
 * A neutral route mounts at its controller path unchanged, so a health check or
 * a webhook a version bump must not move can sit beside versioned routes. It is
 * not a version string; a route that declares it is reachable at every path the
 * versioned routes are not, and at none of the `/vN` paths.
 */
export const VERSION_NEUTRAL: unique symbol = Symbol("aponia.version.neutral");

/** The value `@Version()` accepts: a segment or the neutral marker. */
export type VersionValue = string | typeof VERSION_NEUTRAL;

/** The versioning strategies the framework can describe. */
export const VersioningType = Object.freeze({
  URI: "uri",
  HEADER: "header",
  MEDIA_TYPE: "media-type",
} as const);

/** A versioning strategy name. */
export type VersioningType = (typeof VersioningType)[keyof typeof VersioningType];

/**
 * Declares the version a controller or handler mounts under.
 *
 * The version is a URI segment: `@Version("1")` mounts under `/v1`, and
 * `@Version("2.0")` under `/v2.0`. A handler declaration overrides the
 * controller declaration.
 *
 * @param version - The non-empty version segment; a leading `v` is optional.
 * @returns A class or method decorator recording the version.
 */
export function Version(version: VersionValue): ClassDecorator & MethodDecorator {
  if (version !== VERSION_NEUTRAL) {
    if (typeof version !== "string" || version.trim() === "" || version.includes("/")) {
      throw new TypeError("Version() requires a non-empty segment without a slash.");
    }
  }
  const normalized = version === VERSION_NEUTRAL ? VERSION_NEUTRAL : version.trim();

  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(versionMetadataKey, normalized, target);
      return;
    }
    Reflect.defineMetadata(versionMetadataKey, normalized, target, propertyKey);
  }) as ClassDecorator & MethodDecorator;
}

/** Reads the version a controller or handler declares. */
export function getVersionMetadata(
  target: object,
  propertyKey?: string | symbol,
): VersionValue | undefined {
  const version =
    propertyKey === undefined
      ? Reflect.getMetadata(versionMetadataKey, target)
      : Reflect.getMetadata(versionMetadataKey, target, propertyKey);
  return typeof version === "string" || version === VERSION_NEUTRAL ? version : undefined;
}

/** The URI segment a version mounts under. */
export function versionPathSegment(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}
