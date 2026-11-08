import { toFetchHandler } from "../fetch/fetch-handler.ts";
import type {
  LambdaHandler,
  LambdaHeaders,
  LambdaHttpEvent,
  LambdaHttpEventV1,
  LambdaHttpEventV2,
  LambdaHttpResultV1,
  LambdaHttpResultV2,
  ServerlessApplication,
} from "./lambda.types.ts";

const textContentTypes = [
  /^text\//iu,
  /^application\/(?:json|xml|javascript|problem\+json|x-www-form-urlencoded|graphql)\b/iu,
  /^image\/svg\+xml\b/iu,
];

/**
 * Builds an AWS Lambda handler for API Gateway HTTP API (payload 2.0) and REST
 * API (payload 1.0) proxy events.
 *
 * The event becomes a standard `Request`, the application answers it through
 * `handle`, and the `Response` becomes the proxy result. A text content type
 * whose bytes are valid UTF-8 travels as text; every other body travels base64,
 * so a binary response is never corrupted by a string decode. `set-cookie`
 * headers become the payload 2.0 `cookies` array or the payload 1.0
 * `multiValueHeaders` entry, because both gateways drop duplicate header names.
 *
 * @param application - The application whose `handle` answers each event.
 * @returns The handler AWS Lambda invokes.
 */
export function createLambdaHandler(application: ServerlessApplication): LambdaHandler {
  const handle = toFetchHandler(application);
  return async (event) => {
    const request = toRequest(event);
    const response = await handle(request);
    return isVersionTwo(event) ? toResultV2(response) : toResultV1(response);
  };
}

function toRequest(event: LambdaHttpEvent): Request {
  return isVersionTwo(event) ? toRequestV2(event) : toRequestV1(event);
}

function toRequestV2(event: LambdaHttpEventV2): Request {
  const host = firstHeader(event.headers, "host") ?? "localhost";
  const query =
    event.rawQueryString === undefined || event.rawQueryString === ""
      ? ""
      : `?${event.rawQueryString}`;
  const url = `https://${host}${event.rawPath}${query}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }
  if (event.cookies !== undefined && event.cookies.length > 0) {
    headers.set("cookie", event.cookies.join("; "));
  }
  const method = event.requestContext.http.method.toUpperCase();
  return new Request(url, {
    method,
    headers,
    ...bodyInit(method, event.body, event.isBase64Encoded),
  });
}

function toRequestV1(event: LambdaHttpEventV1): Request {
  const host =
    firstHeader(event.headers, "host") ??
    firstHeader(joinMultiValueHeaders(event.multiValueHeaders), "host") ??
    "localhost";
  const query =
    event.multiValueQueryStringParameters !== undefined
      ? toQueryString(event.multiValueQueryStringParameters)
      : toSingleQueryString(event.queryStringParameters);
  const url = `https://${host}${event.path}${query}`;
  const headers = new Headers();
  for (const [name, values] of Object.entries(event.multiValueHeaders ?? {})) {
    for (const value of values ?? []) {
      headers.append(name, value);
    }
  }
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined && !headers.has(name)) {
      headers.set(name, value);
    }
  }
  const method = event.httpMethod.toUpperCase();
  return new Request(url, {
    method,
    headers,
    ...bodyInit(method, event.body, event.isBase64Encoded),
  });
}

async function toResultV1(response: Response): Promise<LambdaHttpResultV1> {
  const { headers, cookies } = splitResponseHeaders(response);
  const body = await readBody(response);
  return {
    statusCode: response.status,
    headers,
    ...(cookies.length === 0 ? {} : { multiValueHeaders: { "set-cookie": cookies } }),
    body: body.body,
    isBase64Encoded: body.base64,
  };
}

async function toResultV2(response: Response): Promise<LambdaHttpResultV2> {
  const { headers, cookies } = splitResponseHeaders(response);
  const body = await readBody(response);
  return {
    statusCode: response.status,
    headers,
    ...(cookies.length === 0 ? {} : { cookies }),
    body: body.body,
    isBase64Encoded: body.base64,
  };
}

function splitResponseHeaders(response: Response): {
  readonly headers: Readonly<Record<string, string>>;
  readonly cookies: readonly string[];
} {
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== "set-cookie") {
      headers[name] = value;
    }
  }
  const cookies = response.headers.getSetCookie();
  return { headers: Object.freeze(headers), cookies: Object.freeze([...cookies]) };
}

async function readBody(response: Response): Promise<{ body: string; base64: boolean }> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return { body: "", base64: false };
  }
  const contentType = response.headers.get("content-type") ?? "";
  // An absent content type is the frame Elysia gives a plain string reply; a
  // response with no type is text when its bytes decode, and data otherwise.
  if (contentType === "" || textContentTypes.some((pattern) => pattern.test(contentType))) {
    try {
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { body, base64: false };
    } catch {
      // Fall through: a declared text type with invalid UTF-8 is still data.
    }
  }
  return { body: Buffer.from(bytes).toString("base64"), base64: true };
}

function bodyInit(
  method: string,
  body: string | undefined,
  base64: boolean | undefined,
): { readonly body?: string | Uint8Array } {
  if (method === "GET" || method === "HEAD" || body === undefined || body === "") {
    return {};
  }
  return { body: base64 === true ? Buffer.from(body, "base64") : body };
}

function toSingleQueryString(query: LambdaHeaders | undefined): string {
  if (query === undefined) {
    return "";
  }
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      parameters.append(name, value);
    }
  }
  const serialized = parameters.toString();
  return serialized === "" ? "" : `?${serialized}`;
}

function toQueryString(
  multiValue: Readonly<Record<string, readonly string[] | undefined>> | undefined,
): string {
  if (multiValue === undefined) {
    return "";
  }
  const query = new URLSearchParams();
  for (const [name, values] of Object.entries(multiValue)) {
    for (const value of values ?? []) {
      query.append(name, value);
    }
  }
  const serialized = query.toString();
  return serialized === "" ? "" : `?${serialized}`;
}

function joinMultiValueHeaders(
  headers: Readonly<Record<string, readonly string[] | undefined>> | undefined,
): LambdaHeadersLike {
  const joined: Record<string, string> = {};
  for (const [name, values] of Object.entries(headers ?? {})) {
    if (values !== undefined && values.length > 0) {
      joined[name] = values.join(",");
    }
  }
  return joined;
}

type LambdaHeadersLike = Readonly<Record<string, string | undefined>>;

function firstHeader(headers: LambdaHeadersLike | undefined, name: string): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  for (const [headerName, value] of Object.entries(headers)) {
    if (headerName.toLowerCase() === name && value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function isVersionTwo(event: LambdaHttpEvent): event is LambdaHttpEventV2 {
  return "version" in event && event.version === "2.0";
}
