import "reflect-metadata";

/**
 * Prefix used for metadata symbols created by SetMetadata.
 */
export const customMetadataPrefix = "aponia.custom.metadata:";

/**
 * Assigns custom metadata to a controller class or route handler method.
 *
 * @param metadataKey - The unique key identifying the metadata.
 * @param metadataValue - The value to store.
 * @returns A decorator recording the custom metadata.
 *
 * @example
 * ```ts
 * export const Roles = (...roles: string[]) => SetMetadata("roles", roles);
 *
 * @Roles("admin")
 * @Get("dashboard")
 * getDashboard() {}
 * ```
 */
export function SetMetadata<K = string, V = unknown>(
  metadataKey: K,
  metadataValue: V,
): ClassDecorator & MethodDecorator {
  const symbolKey =
    typeof metadataKey === "symbol"
      ? metadataKey
      : Symbol.for(`${customMetadataPrefix}${String(metadataKey)}`);

  return ((
    target: object,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ): void => {
    if (propertyKey !== undefined) {
      if (
        (descriptor?.value && typeof descriptor.value === "object") ||
        typeof descriptor?.value === "function"
      ) {
        Reflect.defineMetadata(symbolKey, metadataValue, descriptor.value as object);
      }
      Reflect.defineMetadata(symbolKey, metadataValue, target, propertyKey);
    } else {
      Reflect.defineMetadata(symbolKey, metadataValue, target);
    }
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Retrieves custom metadata set via SetMetadata.
 *
 * @param metadataKey - The metadata key.
 * @param target - The method function, prototype, or class constructor.
 * @param propertyKey - Optional method name.
 * @returns The stored metadata value, or undefined.
 */
export function getCustomMetadata<T = unknown>(
  metadataKey: unknown,
  target: object,
  propertyKey?: string | symbol,
): T | undefined {
  const symbolKey =
    typeof metadataKey === "symbol"
      ? metadataKey
      : Symbol.for(`${customMetadataPrefix}${String(metadataKey)}`);

  if (propertyKey !== undefined) {
    return Reflect.getMetadata(symbolKey, target, propertyKey) as T | undefined;
  }
  return Reflect.getMetadata(symbolKey, target) as T | undefined;
}
