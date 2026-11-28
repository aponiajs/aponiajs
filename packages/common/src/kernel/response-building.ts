import type { ResponseSettingsState } from "../interfaces/route-schema.interface.ts";
import { statusCodeOf } from "../exceptions/http-status-map.ts";

/**
 * Turns a handler's return value and the response settings it wrote into the
 * `Response` the host sends.
 *
 * A `Response` the handler built is sent unchanged. A string is text, bytes and
 * streams pass through, and every other value is JSON. The status a handler
 * declared, or named, wins over the default `200`.
 *
 * @param value - The handler's value, after interceptors and serialization.
 * @param set - The settings the handler wrote.
 * @param method - The request method, so a `HEAD` answer carries no body.
 * @returns The response to send.
 */
/**
 * Returns `true` when `headers` contains at least one defined header entry,
 * avoiding `Object.entries` array allocation on empty response settings.
 *
 * @internal
 */
export function hasResponseHeaderEntries(
  headers: Record<string, string | number | string[] | undefined>,
): boolean {
  for (const name in headers) {
    if (Object.hasOwn(headers, name) && headers[name] !== undefined) {
      return true;
    }
  }
  return false;
}

const textPlainInit200 = { headers: { "content-type": "text/plain; charset=utf-8" } };
const headJsonInit200 = {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
};

/**
 * Builds the `Response` for a route handler return value using the accumulated response settings.
 */
export function buildResponse(
  value: unknown,
  set: ResponseSettingsState,
  method: string,
): Response {
  if (value instanceof Response) {
    return value;
  }

  const status = resolveStatus(set.status);
  if (!hasResponseHeaderEntries(set.headers)) {
    const statusInit = status === 200 ? undefined : { status };
    if (value === undefined || value === null) {
      return new Response(null, statusInit);
    }
    if (
      value instanceof Uint8Array ||
      value instanceof ArrayBuffer ||
      value instanceof Blob ||
      value instanceof ReadableStream
    ) {
      return new Response(value, statusInit);
    }
    if (typeof value === "string") {
      if (method === "HEAD") {
        return new Response(null, {
          status,
          headers: textPlainInit200.headers,
        });
      }
      return new Response(
        value,
        status === 200 ? textPlainInit200 : { status, headers: textPlainInit200.headers },
      );
    }
    if (method === "HEAD") {
      return new Response(
        null,
        status === 200 ? headJsonInit200 : { status, headers: headJsonInit200.headers },
      );
    }
    return Response.json(value, statusInit);
  }

  const headers = new Headers();
  for (const [name, entry] of Object.entries(set.headers)) {
    if (entry === undefined) {
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        headers.append(name, String(item));
      }
      continue;
    }
    headers.set(name, String(entry));
  }

  if (value === undefined || value === null) {
    return new Response(null, { status, headers });
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob) {
    return new Response(value, { status, headers });
  }
  if (value instanceof ReadableStream) {
    return new Response(value, { status, headers });
  }

  if (typeof value === "string") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "text/plain; charset=utf-8");
    }
    return new Response(method === "HEAD" ? null : value, { status, headers });
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  const body = JSON.stringify(value);
  return new Response(method === "HEAD" ? null : body, { status, headers });
}

function resolveStatus(status: ResponseSettingsState["status"]): number {
  if (status === undefined) {
    return 200;
  }
  if (typeof status === "number") {
    return status;
  }
  return statusCodeOf(status as never) ?? 200;
}
