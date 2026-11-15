import "reflect-metadata";
import type { ClassToken } from "../tokens/token.types.ts";
import type { ResponseHeaderValue } from "./response-metadata.types.ts";

/**
 * Own-only metadata keys. A method decorator records per handler property, and
 * a subclass never inherits its parent's declarations.
 */
const responseHeadersMetadataKey = Symbol.for("aponia.response-headers.metadata");
const httpCodeMetadataKey = Symbol.for("aponia.http-code.metadata");

/** Header declarations, keyed by handler property. */
type HeadersByProperty = ReadonlyMap<
  string | symbol,
  Readonly<Record<string, ResponseHeaderValue>>
>;

/** Status declarations, keyed by handler property. */
type CodesByProperty = ReadonlyMap<string | symbol, number>;

function isHeaderValue(value: unknown): value is ResponseHeaderValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

/**
 * Declares a response header the route answers with.
 *
 * Applied more than once, the declarations merge per handler; the platform sets
 * them before the guards run, so a refusal carries them too. A header a handler
 * or an interceptor sets later wins.
 *
 * @param name - The header name; must be non-empty.
 * @param value - A string, a number, or a list of strings.
 * @returns A method decorator recording the header.
 * @throws A `TypeError` when the name is empty or the value has another shape.
 *
 * @example
 * ```ts
 * @Get()
 * @Header("cache-control", "no-store")
 * find() {}
 * ```
 */
export function Header(name: string, value: ResponseHeaderValue): MethodDecorator {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("Header() requires a non-empty header name.");
  }
  if (!isHeaderValue(value)) {
    throw new TypeError("Header() value must be a string, a number, or a list of strings.");
  }

  const frozen = Array.isArray(value) ? Object.freeze([...value]) : value;

  return (target: object, propertyKey: string | symbol): void => {
    const existing =
      (Reflect.getOwnMetadata(responseHeadersMetadataKey, target) as
        | HeadersByProperty
        | undefined) ?? new Map();
    const declared = existing.get(propertyKey) ?? {};
    const next = new Map(existing);
    next.set(propertyKey, Object.freeze({ ...declared, [name]: frozen }));
    Reflect.defineMetadata(responseHeadersMetadataKey, next, target);
  };
}

/**
 * Declares the status a route answers with when its handler returns a value.
 *
 * The platform sets the status before the guards run. A handler that returns a
 * `Response`, throws `HttpError`, or sets a status itself still decides its own.
 *
 * @param status - An integer HTTP status between 100 and 599.
 * @returns A method decorator recording the status.
 * @throws A `TypeError` when the status is not an integer in range.
 */
export function HttpCode(status: number): MethodDecorator {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new TypeError("HttpCode() requires an integer status between 100 and 599.");
  }

  return (target: object, propertyKey: string | symbol): void => {
    const existing =
      (Reflect.getOwnMetadata(httpCodeMetadataKey, target) as CodesByProperty | undefined) ??
      new Map();
    const next = new Map(existing);
    next.set(propertyKey, status);
    Reflect.defineMetadata(httpCodeMetadataKey, next, target);
  };
}

/**
 * Reads the response headers one handler declared.
 *
 * @param target - The controller class to read.
 * @param propertyKey - The handler method to read.
 * @returns The frozen header record, or `undefined` when the handler declares none.
 */
export function getResponseHeaders(
  target: ClassToken<unknown>,
  propertyKey: string | symbol,
): Readonly<Record<string, ResponseHeaderValue>> | undefined {
  const byProperty = Reflect.getOwnMetadata(responseHeadersMetadataKey, target.prototype) as
    | HeadersByProperty
    | undefined;
  const declared = byProperty?.get(propertyKey);
  return declared === undefined ? undefined : Object.freeze({ ...declared });
}

/**
 * Reads the status one handler declared.
 *
 * @param target - The controller class to read.
 * @param propertyKey - The handler method to read.
 * @returns The declared status, or `undefined` when the handler declares none.
 */
export function getHttpCode(
  target: ClassToken<unknown>,
  propertyKey: string | symbol,
): number | undefined {
  const byProperty = Reflect.getOwnMetadata(httpCodeMetadataKey, target.prototype) as
    | CodesByProperty
    | undefined;
  return byProperty?.get(propertyKey);
}
