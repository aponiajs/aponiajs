import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { httpErrors } from "@aponiajs/platform-elysia";
import type { ResolvedIdempotencyOptions } from "../module/idempotency-module.types.ts";
import type {
  IdempotencyStore,
  StoredIdempotentResponse,
} from "../store/idempotency-store.types.ts";

interface IdempotencyContext {
  readonly request: Request;
  readonly body?: unknown;
  readonly path?: string;
  readonly set: { status?: number | string; headers: Record<string, string> };
}

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

/**
 * Builds the native plugin that replays a mutating request against its key.
 *
 * The first request with a key runs normally and records its answer; a repeat
 * with the same fingerprint answers the recorded status and body without
 * reaching the handler. A key reused with a different request is refused with
 * `409`, and a concurrent repeat waits for the first answer instead of running
 * the handler twice.
 */
export function idempotencyPlugin(options: ResolvedIdempotencyOptions): Elysia {
  const methods = new Set(options.methods);
  const states = new WeakMap<Request, RequestState>();
  const inflight = new Map<string, Promise<void>>();
  const pendingClaimTtlMs = Math.min(options.ttlMs, maxClaimTtlMs);

  // A route-level error hook answers first, so the plugin's own error hook is
  // not the release path for a failed handler. `afterResponse` is: it runs for
  // the answer whatever produced it, and drops the in-flight claim so the next
  // attempt can run instead of waiting on a promise nobody resolves.
  const release = (request: Request): void => {
    const state = states.get(request);
    if (state !== undefined) {
      states.delete(request);
      state.release();
    }
  };

  const replay = async (
    context: IdempotencyContext,
    key: string,
    fingerprint: string,
  ): Promise<unknown> => {
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
      throw httpErrors.conflict("The idempotency key was already used for a different request.");
    }
    context.set.status = stored.status;
    return stored.value;
  };

  const plugin = new Elysia({ name: "aponia.idempotency" })
    .onBeforeHandle("global", async (context) => {
      const request = context.request;
      if (!methods.has(request.method.toUpperCase())) {
        return undefined;
      }
      const raw = request.headers.get(options.header);
      if (raw === null || raw.trim() === "") {
        if (options.requireKey) {
          throw httpErrors.badRequest(`The ${options.header} header is required.`);
        }
        return undefined;
      }
      const rawKey = raw.trim();
      if (rawKey.length > maxKeyLength) {
        throw httpErrors.badRequest(`The ${options.header} header is too long.`);
      }
      const idempotencyContext = context as unknown as IdempotencyContext;
      const fingerprint = fingerprintOf(idempotencyContext);
      const key = scopeKey(rawKey, options.scope?.(request));
      const answered = await replay(idempotencyContext, key, fingerprint);
      if (answered !== undefined) {
        return answered;
      }
      const running = inflight.get(key);
      if (running !== undefined) {
        await running;
        const after = await replay(idempotencyContext, key, fingerprint);
        if (after !== undefined) {
          return after;
        }
      }
      const claim = await claimKey(options.store, key, pendingClaimTtlMs, options.onError);
      if (claim === "busy") {
        const after = await waitForReplay(idempotencyContext, key, fingerprint, replay);
        if (after !== undefined) {
          return after;
        }
        throw httpErrors.conflict("The idempotency key is currently being processed.");
      }
      const claimed = claim === "claimed";
      let resolve: (() => void) | undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      inflight.set(key, promise);
      states.set(request, {
        key,
        fingerprint,
        claimed,
        release: () => {
          resolve?.();
          inflight.delete(key);
          if (claimed) {
            releaseClaim(options.store, key, options.onError);
          }
        },
      });
      return undefined;
    })
    .onAfterHandle("global", async (context) => {
      const state = states.get(context.request);
      if (state === undefined) {
        return undefined;
      }
      const status = statusOf(context.set.status);
      const value = (context as { readonly responseValue?: unknown }).responseValue;
      if (status >= 200 && status < 300 && storable(value)) {
        try {
          await options.store.set(
            state.key,
            Object.freeze({ status, value, fingerprint: state.fingerprint }),
            options.ttlMs,
          );
        } catch (error) {
          options.onError(error, state.key);
        }
      }
      release(context.request);
      return undefined;
    })
    .onAfterResponse("global", (context) => {
      release(context.request);
      return undefined;
    })
    .onError((context) => {
      release(context.request);
      return undefined;
    });

  return plugin as unknown as Elysia;
}

function fingerprintOf(context: IdempotencyContext): string {
  const body = context.body;
  const serialized =
    body instanceof Uint8Array
      ? Buffer.from(body).toString("base64")
      : body === undefined
        ? ""
        : JSON.stringify(body);
  return createHash("sha256")
    .update(`${context.request.method}\n${context.path ?? new URL(context.request.url).pathname}\n`)
    .update(serialized ?? "")
    .digest("hex");
}

function statusOf(status: number | string | undefined): number {
  return typeof status === "number" ? status : 200;
}

function storable(value: unknown): boolean {
  if (value === undefined || value instanceof Response) {
    return false;
  }
  return !(
    typeof value === "object" &&
    value !== null &&
    (Symbol.iterator in value || Symbol.asyncIterator in value)
  );
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
  context: IdempotencyContext,
  key: string,
  fingerprint: string,
  replay: (context: IdempotencyContext, key: string, fingerprint: string) => Promise<unknown>,
): Promise<unknown> {
  for (let attempt = 0; attempt < replayWaitAttempts; attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, replayWaitMs);
    });
    const answered = await replay(context, key, fingerprint);
    if (answered !== undefined) {
      return answered;
    }
  }
  return undefined;
}
