import type { RouteContext } from "./route-schema.types.ts";

/** A function that shapes one route handler's result before it is sent. */
export type ResponseSerializer<T = unknown> = (
  value: unknown,
  context: RouteContext,
) => T | Promise<T>;

const responseSerializerMetadataKey = Symbol.for("aponia.response-serializer.metadata");

/**
 * Declares a serializer for one controller or one route handler.
 *
 * A method serializer wins over a controller serializer. The serializer runs
 * after the handler and after the route's interceptor `after` halves.
 *
 * @param serializer - The function that shapes the response.
 * @returns A class or method decorator recording the serializer.
 */
export function Serialize(serializer: ResponseSerializer): ClassDecorator & MethodDecorator {
  if (typeof serializer !== "function") {
    throw new TypeError("Serialize() requires a serializer function.");
  }

  return ((target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(responseSerializerMetadataKey, serializer, target);
      return;
    }
    Reflect.defineMetadata(responseSerializerMetadataKey, serializer, target, propertyKey);
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Reads the serializer a controller or handler declares.
 *
 * @param target - The controller constructor or its prototype.
 * @param propertyKey - The handler key when reading a method serializer.
 * @returns The serializer, or undefined when none is declared.
 */
export function getResponseSerializer(
  target: object,
  propertyKey?: string | symbol,
): ResponseSerializer | undefined {
  const serializer =
    propertyKey === undefined
      ? Reflect.getMetadata(responseSerializerMetadataKey, target)
      : Reflect.getMetadata(responseSerializerMetadataKey, target, propertyKey);
  return typeof serializer === "function" ? (serializer as ResponseSerializer) : undefined;
}
