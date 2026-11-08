import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { httpErrors } from "@aponiajs/platform-elysia";
import type { ResolvedIdempotencyOptions } from "../module/idempotency-module.types.ts";
import type { StoredIdempotentResponse } from "../store/idempotency-store.types.ts";

interface IdempotencyContext {
  readonly request: Request;
  readonly body?: unknown;
  readonly path?: string;
  readonly set: { status?: number | string; headers: Record<string, string> };
}

interface RequestState {
  readonly key: string;
  readonly fingerprint: string;
  readonly release: () => void;
}

const maxKeyLength = 255;

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
    .beforeHandle("global", async (context) => {
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
      const key = raw.trim();
      if (key.length > maxKeyLength) {
        throw httpErrors.badRequest(`The ${options.header} header is too long.`);
      }
      const idempotencyContext = context as unknown as IdempotencyContext;
      const fingerprint = fingerprintOf(idempotencyContext);
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
      let resolve: (() => void) | undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      inflight.set(key, promise);
      states.set(request, {
        key,
        fingerprint,
        release: () => {
          resolve?.();
          inflight.delete(key);
        },
      });
      return undefined;
    })
    .afterHandle("global", async (context) => {
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
    .afterResponse("global", (context) => {
      release(context.request);
      return undefined;
    })
    .error((context) => {
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
