const cacheKeyMetadataKey = Symbol.for("aponia.cache.key.metadata");

/**
 * Names the cache key a handler's response is stored under.
 *
 * Mirrors `@nestjs/cache-manager`'s `@CacheKey()`: the value is metadata only,
 * and `CacheInterceptor` reads it when it records a `GET` response.
 *
 * @param key - The non-empty key the response is stored under.
 * @returns The method decorator.
 * @throws A `TypeError` at the decoration site when the key is empty.
 */
export function CacheKey(key: string): MethodDecorator {
  if (typeof key !== "string" || key.trim() === "") {
    throw new TypeError("CacheKey() requires a non-empty string.");
  }

  return ((target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    Reflect.defineMetadata(cacheKeyMetadataKey, key, descriptor.value as object);
  }) as MethodDecorator;
}

/** Reads the key a handler declares; `undefined` when it declares none. */
export function getCacheKeyMetadata(handler: object): string | undefined {
  const value = Reflect.getOwnMetadata(cacheKeyMetadataKey, handler);
  return typeof value === "string" ? value : undefined;
}
