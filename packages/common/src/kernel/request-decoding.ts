import { HttpError } from "../exceptions/http-error.ts";

/** The largest body the kernel reads unless an application states another bound. */
export const defaultMaxBodyBytes = 1024 * 1024;

/**
 * Reads the query string into a plain record.
 *
 * A name that appears once answers a string; a name that repeats answers an
 * array in the order the request stated it.
 *
 * @param url - The request URL.
 * @returns The record.
 */
export function readQuery(url: URL): Readonly<Record<string, string | string[]>> {
  // A null prototype keeps a query named `constructor` or `__proto__` from
  // reaching Object.prototype and corrupting the record.
  const query: Record<string, string | string[]> = Object.create(null);
  for (const [name, value] of url.searchParams) {
    const existing = Object.hasOwn(query, name) ? query[name] : undefined;
    if (existing === undefined) {
      query[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[name] = [existing, value];
    }
  }
  return Object.freeze(query);
}

/**
 * Reads the request headers under lower-case names.
 *
 * HTTP field names are case-insensitive, so one spelling reaches both a
 * validator and a handler. A repeated field is joined with `, `, as the
 * underlying `Headers` object already does.
 *
 * @param request - The request.
 * @returns The record.
 */
export function readHeaders(request: Request): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) {
    headers[name.toLowerCase()] = value;
  }
  return Object.freeze(headers);
}

/**
 * Reads the request cookies into the `{ value }` records a handler reads.
 *
 * @param request - The request.
 * @returns The record, empty when the request carries no cookie header.
 */
export function readCookies(
  request: Request,
): Readonly<Record<string, { readonly value: string }>> {
  const header = request.headers.get("cookie");
  if (header === null || header.trim() === "") {
    return Object.freeze({});
  }

  const cookies: Record<string, { readonly value: string }> = Object.create(null);
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    if (name === "") {
      continue;
    }
    cookies[name] = Object.freeze({ value: decode(pair.slice(separator + 1).trim()) });
  }
  return Object.freeze(cookies);
}

/**
 * Percent-decodes one value, keeping the raw value when the escape is invalid.
 *
 * `decodeURIComponent` throws on a malformed sequence such as `100%zz`; a
 * request may carry one, so the decoder falls back rather than failing the
 * request.
 */
export function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Reads the request body according to its content type.
 *
 * A `GET` or `HEAD` request has no body by contract. A body larger than the
 * bound is refused before it is read when the request states a length, and
 * after when it does not.
 *
 * @param request - The request.
 * @param maxBodyBytes - The largest body to accept, in bytes.
 * @returns The decoded body, or `undefined` when the content type states none.
 * @throws `HttpError` 413 for a body over the bound and 400 for malformed JSON.
 */
export async function readBody(
  request: Request,
  maxBodyBytes: number = defaultMaxBodyBytes,
): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD" || request.body === null) {
    return undefined;
  }

  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    throw payloadTooLarge(maxBodyBytes);
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const mediaType = contentType.split(";")[0]?.trim() ?? "";

  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    const text = await readText(request, maxBodyBytes);
    if (text.trim() === "") {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HttpError("Bad Request", {
        code: "INVALID_REQUEST_BODY",
        detail: "The request body is not valid JSON.",
      });
    }
  }

  if (mediaType === "application/x-www-form-urlencoded") {
    const text = await readText(request, maxBodyBytes);
    return Object.freeze(Object.fromEntries(new URLSearchParams(text)));
  }

  if (mediaType === "multipart/form-data") {
    const body = await readBoundedBytes(request, maxBodyBytes);
    const form = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? mediaType },
    }).formData();
    const fields: Record<string, unknown> = {};
    for (const [name, value] of Array.from(form.entries())) {
      const existing = fields[name];
      if (existing === undefined) {
        fields[name] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        fields[name] = [existing, value];
      }
    }
    return Object.freeze(fields);
  }

  if (mediaType.startsWith("text/")) {
    return await readText(request, maxBodyBytes);
  }

  return undefined;
}

async function readText(request: Request, maxBodyBytes: number): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBodyBytes);
  return new TextDecoder().decode(bytes);
}

async function readBoundedBytes(request: Request, maxBodyBytes: number): Promise<Uint8Array> {
  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        throw payloadTooLarge(maxBodyBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function payloadTooLarge(maxBodyBytes: number): HttpError {
  return new HttpError("Payload Too Large", {
    code: "PAYLOAD_TOO_LARGE",
    detail: `The request body exceeds ${maxBodyBytes} bytes.`,
  });
}
