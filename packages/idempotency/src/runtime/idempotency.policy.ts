import { createHash } from "node:crypto";
import { once } from "@aponiajs/compiler";
import { httpErrors, type HttpPolicy } from "@aponiajs/platform-core";
import type { ResolvedIdempotencyOptions } from "../interfaces/idempotency-module.interface.ts";
import type {
  IdempotencyStore,
  StoredIdempotentResponse,
} from "../interfaces/idempotency-store.interface.ts";

interface RequestState {
  readonly key: string;
  readonly fingerprint: string;
  readonly claimed: boolean;
  readonly release: () => void;
}

const maxKeyLength = 255;
/** A pending claim must expire quickly; the recorded response has its own TTL. */
const maxClaimTtlMs = 30_000;
const replayWaitAttempts = 20;
const replayWaitMs = 25;
const identityHeaders = Object.freeze([
  "authorization",
  "cookie",
  "x-api-key",
  "x-tenant-id",
  "x-user-id",
]);

/**
 * Builds the neutral idempotency policy one registration contributes.
 *
 * The first request with a key runs normally and records its answer; a repeat
 * with the same fingerprint answers the recorded status and body without
 * reaching the handler. A key reused with a different request is refused with
 * `409`, and a concurrent repeat waits for the first answer instead of running
 * the handler twice. The fingerprint is taken over the raw request bytes, so a
 * binary body is fingerprinted by its bytes rather than by a parsed value.
 *
 * `close` releases every claim this registration still holds, so a stopping
 * application does not leave a key blocked for its whole TTL.
 *
 * @internal
 */
export function createIdempotencyPolicy(options: ResolvedIdempotencyOptions): {
  readonly policy: HttpPolicy;
  readonly close: () => void;
} {
  const methods = new Set(options.methods);
  // A Map rather than a WeakMap: `close` must forget the state it released, so
  // the same request's response boundary cannot release it a second time.
  const states = new Map<Request, RequestState>();
  const inflight = new Map<string, Promise<void>>();
  const pendingClaimTtlMs = Math.min(options.ttlMs, maxClaimTtlMs);

  const release = (request: Request): void => {
    const state = states.get(request);
    if (state === undefined) {
      return;
    }
    states.delete(request);
    state.release();
  };

  const replay = async (key: string, fingerprint: string): Promise<Response | undefined> => {
    let stored: StoredIdempotentResponse | undefined;
    try {
      stored = await options.store.get(key);
    } catch (error) {
      options.onError(error, key);
      return undefined;
    }
    if (stored === undefined) {
      return undefined;
    }
    if (stored.fingerprint !== fingerprint) {
      return httpErrors
        .conflict("The idempotency key was already used for a different request.")
        .toResponse();
    }
    const headers = new Headers();
    if (stored.contentType !== undefined) {
      headers.set("content-type", stored.contentType);
    }
    return new Response(typeof stored.value === "string" ? stored.value : "", {
      status: stored.status,
      headers,
    });
  };

  const policy: HttpPolicy = {
    name: "idempotency",
    async onRequest(request) {
      if (!methods.has(request.method.toUpperCase())) {
        return undefined;
      }
      const raw = request.headers.get(options.header);
      if (raw === null || raw.trim() === "") {
        return options.requireKey
          ? httpErrors.badRequest(`The ${options.header} header is required.`).toResponse()
          : undefined;
      }
      const rawKey = raw.trim();
      if (rawKey.length > maxKeyLength) {
        return httpErrors.badRequest(`The ${options.header} header is too long.`).toResponse();
      }

      const fingerprint = await fingerprintOf(request);
      const key = scopeKey(rawKey, options.scope?.(request) ?? defaultScope(request));
      const answered = await replay(key, fingerprint);
      if (answered !== undefined) {
        return answered;
      }
      const running = inflight.get(key);
      if (running !== undefined) {
        await running;
        const after = await replay(key, fingerprint);
        if (after !== undefined) {
          return after;
        }
      }

      // Reserve the key before the first await: with a store that offers no
      // atomic claim, two concurrent requests would otherwise both reach the
      // handler.
      let resolve: (() => void) | undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      inflight.set(key, promise);
      const abandon = (): void => {
        resolve?.();
        inflight.delete(key);
      };

      const claim = await claimKey(options.store, key, pendingClaimTtlMs, options.onError);
      if (claim === "busy") {
        abandon();
        const after = await waitForReplay(key, fingerprint, replay);
        if (after !== undefined) {
          return after;
        }
        return httpErrors
          .conflict("The idempotency key is currently being processed.")
          .toResponse();
      }
      const claimed = claim === "claimed";
      const state: RequestState = {
        key,
        fingerprint,
        claimed,
        release: once(() => {
          resolve?.();
          inflight.delete(key);
          if (claimed) {
            releaseClaim(options.store, key, options.onError);
          }
        }),
      };
      states.set(request, state);
      return undefined;
    },
    async onResponse(request, response) {
      const state = states.get(request);
      if (state === undefined) {
        return response;
      }
      try {
        if (response.status >= 200 && response.status < 300) {
          const contentType = response.headers.get("content-type");
          if (contentType === null || !contentType.startsWith("text/event-stream")) {
            const value = await response.clone().text();
            await options.store.set(
              state.key,
              Object.freeze({
                status: response.status,
                value,
                fingerprint: state.fingerprint,
                ...(contentType === null ? {} : { contentType }),
              }),
              options.ttlMs,
            );
          }
        }
      } catch (error) {
        options.onError(error, state.key);
      } finally {
        release(request);
      }
      return response;
    },
  };

  return Object.freeze({
    policy: Object.freeze(policy),
    close(): void {
      for (const state of states.values()) {
        state.release();
      }
      states.clear();
      inflight.clear();
    },
  });
}

async function fingerprintOf(request: Request): Promise<string> {
  const url = new URL(request.url);
  let body = "";
  try {
    body = await request.clone().text();
  } catch {
    // A body the runtime cannot clone is fingerprinted as absent; the request
    // itself still runs.
    body = "";
  }
  return createHash("sha256")
    .update(`${request.method}\n${url.pathname}\n${url.search}\n`)
    .update(body)
    .digest("hex");
}

/**
 * The default caller scope.
 *
 * A key is application input, not an identity. When the application does not
 * supply a scope, bind the key to the credential-bearing headers the request
 * carries so two callers cannot replay each other's answer. An unauthenticated
 * request has no stable identity to bind, so its keys stay shared.
 */
function defaultScope(request: Request): string | undefined {
  const parts: string[] = [];
  for (const name of identityHeaders) {
    const value = request.headers.get(name);
    if (value !== null && value.trim() !== "") {
      parts.push(`${name}=${value}`);
    }
  }
  return parts.length === 0
    ? undefined
    : createHash("sha256").update(parts.join("\n")).digest("hex");
}

type ClaimOutcome = "claimed" | "busy" | "unavailable";

/**
 * Claims the key when the store supports it.
 *
 * `"unavailable"` means the store has no atomic claim or the claim itself
 * failed: the request proceeds with the single-process guarantee, because a
 * store failure must not replace the answer. `"busy"` means another replica
 * holds the key.
 */
async function claimKey(
  store: IdempotencyStore,
  key: string,
  ttlMs: number,
  onError: (error: unknown, key: string) => void,
): Promise<ClaimOutcome> {
  if (store.claim === undefined) {
    return "unavailable";
  }
  try {
    return (await store.claim(key, ttlMs)) ? "claimed" : "busy";
  } catch (error) {
    onError(error, key);
    return "unavailable";
  }
}

function releaseClaim(
  store: IdempotencyStore,
  key: string,
  onError: (error: unknown, key: string) => void,
): void {
  if (store.release === undefined) {
    return;
  }
  try {
    void Promise.resolve(store.release(key)).catch((error) => onError(error, key));
  } catch (error) {
    onError(error, key);
  }
}

function scopeKey(key: string, scope: string | undefined): string {
  return scope === undefined || scope === "" ? key : `${scope}:${key}`;
}

async function waitForReplay(
  key: string,
  fingerprint: string,
  replay: (key: string, fingerprint: string) => Promise<Response | undefined>,
): Promise<Response | undefined> {
  for (let attempt = 0; attempt < replayWaitAttempts; attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, replayWaitMs);
    });
    const answered = await replay(key, fingerprint);
    if (answered !== undefined) {
      return answered;
    }
  }
  return undefined;
}
