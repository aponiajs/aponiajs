const serializeOptionsMetadataKey = Symbol.for("aponia.serialize-options.metadata");

/** The options Nest's `@SerializeOptions()` accepts. */
export interface SerializeOptions {
  /** Keep only the properties the serializer exposes. */
  readonly excludeExtraneousValues?: boolean;
  /** Property-name prefixes to drop. */
  readonly excludePrefixes?: readonly string[];
  /** Whether every property is exposed or only explicitly exposed ones. */
  readonly strategy?: "excludeAll" | "exposeAll";
  /** The DTO type a response is projected into. */
  readonly type?: Function;
  /** The serialization groups a response is filtered by. */
  readonly groups?: readonly string[];
}

/**
 * Declares class-transformer-style options for one controller or handler.
 *
 * A method declaration wins over a controller declaration, matching Nest.
 *
 * @param options - The serialization options.
 * @returns A class or method decorator recording the options.
 */
export function SerializeOptions(options: SerializeOptions): ClassDecorator & MethodDecorator {
  const frozen = Object.freeze({
    ...options,
    ...(options.excludePrefixes === undefined
      ? {}
      : { excludePrefixes: Object.freeze([...options.excludePrefixes]) }),
    ...(options.groups === undefined ? {} : { groups: Object.freeze([...options.groups]) }),
  });
  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(serializeOptionsMetadataKey, frozen, target);
      return;
    }
    Reflect.defineMetadata(serializeOptionsMetadataKey, frozen, target, propertyKey);
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Reads the serialization options a controller or handler declares.
 *
 * @param target - The controller constructor or its prototype.
 * @param propertyKey - The handler key when reading a method declaration.
 * @returns The options, or `undefined` when none are declared.
 */
export function getSerializeOptions(
  target: object,
  propertyKey?: string | symbol,
): SerializeOptions | undefined {
  const options =
    propertyKey === undefined
      ? Reflect.getMetadata(serializeOptionsMetadataKey, target)
      : Reflect.getMetadata(serializeOptionsMetadataKey, target, propertyKey);
  return typeof options === "object" && options !== null
    ? (options as SerializeOptions)
    : undefined;
}
