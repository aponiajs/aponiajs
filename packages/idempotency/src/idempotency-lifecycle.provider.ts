import { createHash } from "node:crypto";
import type { RequestLifecycleHook } from "@aponiajs/common";
import type {
  IdempotencyAcquireResult,
  IdempotencyRecord,
  IdempotencyStore,
  ResolvedIdempotencyOptions,
} from "./interfaces/idempotency-store.interface.ts";

/**
 * Creates the `RequestLifecycleHook` enforcing `Idempotency-Key` deduplication,
 * in-flight conflict rejection (`409`), payload mismatch detection (`422`),
 * and fail-closed (`503`) store error handling.
 */
export function createIdempotencyLifecycleHook(
  options: ResolvedIdempotencyOptions,
  store: IdempotencyStore,
): RequestLifecycleHook {
  return {
    name: "idempotency",
    async wrap(request: Request, next: (request: Request) => Promise<Response>): Promise<Response> {
      const method = request.method.toUpperCase();
      if (!options.methods.has(method)) {
        return await next(request);
      }

      const rawKey = request.headers.get(options.headerName);
      if (rawKey === null || rawKey.trim() === "") {
        if (options.requireKey) {
          return problemResponse(
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            `Header "${options.headerName}" is required for ${method} requests.`,
          );
        }
        return await next(request);
      }

      const pathname = extractPathname(request.url);
      const scopedKey = `${method}:${pathname}:${rawKey.trim()}`;
      const bodyBuffer = new Uint8Array(await request.clone().arrayBuffer());
      const requestHash = computeRequestHash(method, pathname, bodyBuffer);

      let acquired: IdempotencyAcquireResult;
      try {
        acquired = await store.acquire(scopedKey, options.ttlMs, requestHash);
      } catch {
        return problemResponse(
          503,
          "IDEMPOTENCY_STORE_UNAVAILABLE",
          "Idempotency store is unavailable.",
        );
      }

      if (acquired.state === "in_flight") {
        return problemResponse(
          409,
          "IDEMPOTENCY_IN_FLIGHT",
          "A request with this Idempotency-Key is already in progress.",
        );
      }

      if (acquired.state === "completed") {
        if (acquired.record.requestHash !== requestHash) {
          return problemResponse(
            422,
            "IDEMPOTENCY_PAYLOAD_MISMATCH",
            "Idempotency-Key was reused with a different request payload.",
          );
        }
        const headers = new Headers(acquired.record.headers);
        headers.set("idempotent-replayed", "true");
        return new Response(acquired.record.body, {
          status: acquired.record.statusCode,
          headers,
        });
      }

      let response: Response;
      try {
        response = await next(request);
      } catch (error) {
        await safeRelease(store, scopedKey);
        throw error;
      }

      if (response.status >= 500) {
        await safeRelease(store, scopedKey);
        return response;
      }

      const responseBody = await response.text();
      const recordedHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        recordedHeaders[key] = value;
      });
      const record: IdempotencyRecord = {
        statusCode: response.status,
        headers: recordedHeaders,
        body: responseBody,
        requestHash,
        expiresAt: Date.now() + options.ttlMs,
      };

      try {
        await store.complete(scopedKey, record, options.ttlMs);
      } catch {
        return problemResponse(
          503,
          "IDEMPOTENCY_STORE_UNAVAILABLE",
          "Failed to persist idempotency response.",
        );
      }

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}

async function safeRelease(store: IdempotencyStore, key: string): Promise<void> {
  try {
    await store.release(key);
  } catch {
    // Best-effort release when handler already failed.
  }
}

function computeRequestHash(method: string, pathname: string, body: Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(method);
  hash.update("\n");
  hash.update(pathname);
  hash.update("\n");
  hash.update(body);
  return hash.digest("hex");
}

function extractPathname(url: string): string {
  const schemeIndex = url.indexOf("://");
  const pathStart = schemeIndex === -1 ? 0 : url.indexOf("/", schemeIndex + 3);
  if (pathStart === -1) {
    return "/";
  }
  const queryIndex = url.indexOf("?", pathStart);
  return queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex);
}

function problemResponse(status: number, code: string, detail: string): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: code,
      status,
      detail,
    }),
    {
      status,
      headers: { "content-type": "application/problem+json; charset=utf-8" },
    },
  );
}
