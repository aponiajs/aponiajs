const sseMetadataKey = Symbol.for("aponia.sse.metadata");

/**
 * Marks a controller or handler as a Server-Sent Events route.
 *
 * The platform sets `text/event-stream` and the no-cache/keep-alive headers
 * before the handler runs. The handler returns the payload `sse()` accepts:
 * a string, an `SSEPayload`, a generator, an async generator, or a byte stream.
 *
 * @returns A class or method decorator recording the SSE route.
 */
export function Sse(): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(sseMetadataKey, true, target);
      return;
    }
    Reflect.defineMetadata(sseMetadataKey, true, target, propertyKey);
  }) as ClassDecorator & MethodDecorator;
}

/** Reads whether a controller or handler is marked as an SSE route. */
export function isSseRoute(target: object, propertyKey?: string | symbol): boolean {
  const value =
    propertyKey === undefined
      ? Reflect.getMetadata(sseMetadataKey, target)
      : Reflect.getMetadata(sseMetadataKey, target, propertyKey);
  return value === true;
}
