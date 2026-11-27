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
export function buildResponse(
  value: unknown,
  set: ResponseSettingsState,
  method: string,
): Response {
  if (value instanceof Response) {
    return value;
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

  const status = resolveStatus(set.status);
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
