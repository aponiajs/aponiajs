const cacheTtlMetadataKey = Symbol.for("aponia.cache.ttl.metadata");

/**
 * Overrides the registration's default lifetime for one handler's response.
 *
 * Mirrors `@nestjs/cache-manager`'s `@CacheTTL()`: the value is metadata only,
 * and `CacheInterceptor` reads it when it records a `GET` response.
 *
 * @param ttlMs - The entry lifetime in milliseconds.
 * @returns The method decorator.
 * @throws A `TypeError` at the decoration site when the lifetime is not a
 * positive finite number.
 */
export function CacheTTL(ttlMs: number): MethodDecorator {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("CacheTTL() requires a positive finite number of milliseconds.");
  }

  return ((target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void => {
    Reflect.defineMetadata(cacheTtlMetadataKey, ttlMs, descriptor.value as object);
  }) as MethodDecorator;
}

/** Reads the lifetime a handler declares; `undefined` when it declares none. */
export function getCacheTtlMetadata(handler: object): number | undefined {
  const value = Reflect.getOwnMetadata(cacheTtlMetadataKey, handler);
  return typeof value === "number" ? value : undefined;
}
