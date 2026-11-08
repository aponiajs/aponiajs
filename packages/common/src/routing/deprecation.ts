import "reflect-metadata";

const deprecationMetadataKey = Symbol.for("aponia.deprecation.metadata");

/** Options `@Deprecated()` accepts. */
export interface DeprecationOptions {
  /** The date after which the route may be removed; an ISO string or a Date. */
  readonly sunset?: string | Date;
  /** A URL describing the replacement, sent as a `rel="deprecation"` link. */
  readonly link?: string;
}

/** The lowered deprecation policy a route carries. */
export interface DeprecationMetadata {
  readonly sunset?: string;
  readonly link?: string;
}

/**
 * Marks a controller or one handler as deprecated.
 *
 * The route answers `Deprecation: true`, and states `Sunset` and a
 * `rel="deprecation"` link when the declaration carries them.
 *
 * @param options - The sunset date and replacement link.
 * @returns A class or method decorator recording the policy.
 * @throws A `TypeError` when the options are malformed.
 */
export function Deprecated(options: DeprecationOptions = {}): ClassDecorator & MethodDecorator {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("@Deprecated options must be an object.");
  }
  let sunset: string | undefined;
  if (options.sunset !== undefined) {
    const date = options.sunset instanceof Date ? options.sunset : new Date(options.sunset);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError("@Deprecated sunset must be a valid date.");
    }
    sunset = date.toUTCString();
  }
  if (
    options.link !== undefined &&
    (typeof options.link !== "string" || options.link.trim() === "")
  ) {
    throw new TypeError("@Deprecated link must be a non-empty string.");
  }
  const metadata: DeprecationMetadata = Object.freeze({
    ...(sunset === undefined ? {} : { sunset }),
    ...(options.link === undefined ? {} : { link: options.link }),
  });

  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(deprecationMetadataKey, metadata, target);
      return;
    }
    Reflect.defineMetadata(deprecationMetadataKey, metadata, target, propertyKey);
  }) as ClassDecorator & MethodDecorator;
}

/** Reads the deprecation policy a controller or handler declares. */
export function getDeprecationMetadata(
  target: object,
  propertyKey?: string | symbol,
): DeprecationMetadata | undefined {
  const value =
    propertyKey === undefined
      ? Reflect.getMetadata(deprecationMetadataKey, target)
      : Reflect.getMetadata(deprecationMetadataKey, target, propertyKey);
  return typeof value === "object" && value !== null ? (value as DeprecationMetadata) : undefined;
}

/** Writes the headers one deprecation policy answers with. */
export function applyDeprecationHeaders(
  target: Record<string, string | number | string[] | undefined>,
  metadata: DeprecationMetadata,
): void {
  target.deprecation = "true";
  if (metadata.sunset !== undefined) {
    target.sunset = metadata.sunset;
  }
  if (metadata.link !== undefined) {
    target.link = `<${metadata.link}>; rel="deprecation"`;
  }
}
