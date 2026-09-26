import type { DevtoolsOptions } from "../module/devtools-module.types.ts";
import { createRequestBuffer, defaultRequestBufferCapacity } from "./request-buffer.ts";
import type { RequestBuffer, RequestRecord } from "./request-buffer.types.ts";

/** The literal a redacted header is replaced with. */
const redactedValue = "[redacted]";
/** The literal appended to a body the limit cut. */
const truncatedMarker = "[truncated]";
/** The literal a body this package cannot serialize is stored as. */
const unserializableMarker = "[unserializable]";
/** How many characters of a body are stored when a registration names no limit. */
const defaultBodyLimit = 16384;

/**
 * One registration's capture policy: the five options with every opt-out
 * resolved, so nothing downstream reads an option twice or invents a default.
 */
export interface ResolvedCapture {
  /** Whether this registration records requests at all. */
  readonly enabled: boolean;
  /** Whether an entry carries the request's headers. */
  readonly headers: boolean;
  /** Whether an entry carries the parsed request body. */
  readonly body: boolean;
  /** How many characters of a body are stored. */
  readonly bodyLimit: number;
  /** The header names to replace, lowercased, because a header name is case-insensitive. */
  readonly redact: readonly string[];
}

/**
 * What one registration stamped when a request arrived: the record that request
 * belongs to, when it arrived, and the request as it arrived.
 *
 * The request-side facts are read here, at arrival, rather than from the
 * after-response context, because by then the request the socket read no longer
 * states them: its URL survives, but its header list reads empty unless
 * something iterated it during the request — a probe of the installed Elysia
 * reads `[]` in an after-response hook and the six headers a client sent as soon
 * as the request phase touched them. A record assembled from that context would
 * therefore state that the application answered requests carrying no headers at
 * all, which is a claim about the request rather than an absence to leave out.
 *
 * The record is stamped with the arrival as well, because it is one boot's: a
 * request belongs to the record that was open when it arrived, whichever boot
 * has opened one since.
 */
export interface RequestArrival {
  /** The record the boot that saw this request opened. */
  readonly record: RequestBuffer;
  /** The arrival moment, as an ISO-8601 timestamp. */
  readonly timestamp: string;
  /** The arrival reading, which the duration is measured from. */
  readonly startedAt: number;
  /** The method the request arrived with. */
  readonly method: string;
  /** The path the request arrived on. */
  readonly pathname: string;
  /** The query string the request arrived with, including its `?`, or empty. */
  readonly search: string;
  /** The request's headers, already redacted, or absent when the policy leaves them out. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * What the capture reads off the context that answered a request.
 *
 * Stated as the five values rather than as the platform's context type, because
 * these are all the record is built from and because Elysia's context type is
 * generic over the route: the capture reads a fact of the answer, not the shape
 * of a route's schema.
 */
export interface AnsweredRequest {
  /** The request as it arrived. */
  readonly request: Request;
  /** The route pattern Elysia matched, unset when nothing matched. */
  readonly route: unknown;
  /** The body the route parsed. */
  readonly body: unknown;
  /** The status the context carries, as Elysia reports it. */
  readonly status: unknown;
  /** The value the answer carried, as the after-response context reports it. */
  readonly answer: unknown;
}

/**
 * What tells one application apart from another inside one registration: the
 * application's own object.
 *
 * Elysia hands it to the plugin's `onStart` as `application.store` and to every
 * hook as `context.store`, so it is the one value both halves of the pair see
 * that belongs to the application rather than to the registration — which is
 * what makes it the identity a record is filed under. Its shape is Elysia's and
 * this package never reads it.
 */
export type ApplicationIdentity = object;

/**
 * One registration's capture: the pair of hooks that fills a record, and the
 * record itself.
 *
 * The hooks are what the module contributes to its plugin, and they are built
 * when the module is registered — that is the moment this package holds the
 * plugin the request will pass through. A record is not: each boot opens one for
 * the application it serves, through `beginBoot`, and the plugin hands that
 * buffer to the server that serves it.
 *
 * The pair belongs to one registration, and the records belong to the
 * applications it was booted for: a boot reuses the dynamic module a module
 * class was decorated with, so two applications in one process are one
 * registration with two applications' traffic to keep apart.
 */
export interface RequestCapture {
  /**
   * Opens the record for the application this boot serves, filed under the
   * identity every hook of that boot will report, and answers the buffer that
   * boot's server reads.
   *
   * The record is the application's rather than the registration's, because the
   * platform hands one registration to every boot of the module class that
   * declared it: a record held in one variable would be one window for both
   * applications, and each of them would read the other's traffic. The spec
   * draws the same boundary from the other side — the record is in memory, per
   * boot, and a restart is a new record — and a second `listen()`, which serves
   * the same application over a second socket, is that restart.
   */
  beginBoot(application: ApplicationIdentity): RequestBuffer;
  /**
   * Stamps one request as seen by this registration, which is what an entry
   * needs, filed under the application that received it.
   */
  arrive(request: Request, application: ApplicationIdentity): void;
  /** Writes the entry for an answer, when this registration saw the request arrive. */
  complete(context: AnsweredRequest): Promise<void>;
}

/**
 * The policy a registration's `capture` option states, with every opt-out
 * resolved.
 *
 * Everything is captured by default, so `false` — the shorthand for
 * `{ enabled: false }` — is the only value that turns the record off, and a
 * registration that names some options and not others still records what it did
 * not mention.
 */
export function resolveCapture(capture: DevtoolsOptions["capture"]): ResolvedCapture {
  if (capture === false) {
    return Object.freeze({
      enabled: false,
      headers: false,
      body: false,
      bodyLimit: 0,
      redact: Object.freeze([]),
    });
  }

  const options = capture ?? {};

  return Object.freeze({
    enabled: options.enabled ?? true,
    headers: options.headers ?? true,
    body: options.body ?? true,
    bodyLimit: options.bodyLimit ?? defaultBodyLimit,
    redact: Object.freeze((options.redact ?? []).map((name) => name.toLowerCase())),
  });
}

/**
 * One registration's capture, built at registration.
 *
 * The hooks are contributed to the plugin the registration mounts, so they are
 * built here; the record they fill is opened by each boot, for the application
 * it serves. A request that arrives for an application no boot opened a record
 * for leaves no entry, and none is lost: an application that only calls
 * `handle()` publishes nothing, and a boot that never started has no socket to
 * serve a record over.
 *
 * The arrival stamp is keyed by the `Request` object in a `WeakMap`, which
 * outlives nothing and mutates nothing: a request this registration never saw
 * leaves no entry, and the stamp is gone the moment the answer that spends it is
 * recorded. `arrive` stamps only while the policy records, because the stamp is
 * what says this registration saw the request — a registration that records
 * nothing retains nothing.
 *
 * @internal
 */
export function createRequestCapture(capture: DevtoolsOptions["capture"]): RequestCapture {
  const policy = resolveCapture(capture);
  const records = new WeakMap<ApplicationIdentity, RequestBuffer>();
  const arrivals = new WeakMap<Request, RequestArrival>();

  return Object.freeze({
    beginBoot(application: ApplicationIdentity): RequestBuffer {
      const opened = createRequestBuffer(defaultRequestBufferCapacity);

      records.set(application, opened);

      return opened;
    },
    arrive(request: Request, application: ApplicationIdentity): void {
      const open = records.get(application);

      if (!policy.enabled || open === undefined) {
        return;
      }

      // The arrival reading comes first, so the duration is measured from the
      // moment the request reached this registration rather than from the end of
      // reading it, and everything after it is a read of a request that is still
      // whole.
      const startedAt = performance.now();
      const arrived = requestUrl(request);

      arrivals.set(
        request,
        Object.freeze({
          record: open,
          timestamp: new Date().toISOString(),
          startedAt,
          method: request.method,
          pathname: arrived.pathname,
          search: arrived.search,
          ...(policy.headers ? { headers: captureHeaders(request.headers, policy.redact) } : {}),
        }),
      );
    },
    async complete(context: AnsweredRequest): Promise<void> {
      const arrival = arrivals.get(context.request);

      // A request this registration never saw, and an answer whose arrival was
      // spent by an earlier completion, leave nothing rather than a partial
      // entry.
      if (arrival === undefined) {
        return;
      }

      arrivals.delete(context.request);
      arrival.record.write(await toRequestRecord(context, policy, arrival));
    },
  });
}

/**
 * Builds the record for one answered request.
 *
 * `path` is the pattern when the application mounted one and the path that
 * arrived when it did not. The installed Elysia leaves `route` unset for
 * everything that matched nothing — a path no route serves, and a request a
 * plugin refused before matching — and reports a string only for a route it took
 * from the mounted table, which is the same table `/routes` publishes. The check
 * is therefore for a string and not for an empty one: an unset route is not the
 * empty string, and a pattern is never empty. `/routes` is where a consumer tells
 * the two apart, because a pattern the application mounted is in it and a path
 * that arrived without matching one is not.
 *
 * The three optional fields are spread in only when there is something to add,
 * which is what makes an opt-out observable on the wire rather than a field that
 * reads the same as an absence.
 *
 * The request-side fields come from the arrival stamp rather than from
 * `context.request`, which no longer states them by this phase. Every fact the
 * context does state — and the duration, which is measured rather than read — is
 * taken before the one `await` below, because the context is Elysia's for the
 * duration of the hook and the answer's body is the only fact that has to be read
 * across a microtask. The duration is stamped with those facts rather than after
 * them, because a readable `5xx` spends that microtask on this package's own read
 * of the answer, and a duration that included it would report work the
 * application never did.
 *
 * @internal
 */
export async function toRequestRecord(
  context: AnsweredRequest,
  capture: ResolvedCapture,
  arrival: RequestArrival,
): Promise<RequestRecord> {
  const route = routePattern(context.route);
  const status = answerStatus(context);
  const body = capture.body ? captureBody(context.body, capture.bodyLimit) : undefined;
  const durationMs = performance.now() - arrival.startedAt;
  const error = await failureMessage(status, context.answer);

  return Object.freeze({
    method: arrival.method,
    path: route ?? arrival.pathname,
    url: `${arrival.pathname}${arrival.search}`,
    status,
    durationMs,
    timestamp: arrival.timestamp,
    ...(arrival.headers === undefined ? {} : { headers: arrival.headers }),
    ...(body === undefined ? {} : { body }),
    ...(error === undefined ? {} : { error }),
  });
}

/** The pattern Elysia matched, or `undefined` when this request matched none. */
function routePattern(route: unknown): string | undefined {
  return typeof route === "string" && route !== "" ? route : undefined;
}

/**
 * The request as the record states it: its path, and the query string it
 * arrived with.
 *
 * The URL is parsed rather than reported whole, because the origin is the
 * socket's and not the application's: an entry states the address a client
 * asked for, not the address this boot happened to bind. A URL this platform
 * cannot parse is recorded as it arrived rather than dropped — this hook may not
 * throw, because a throw here is a failed request, and a record that stated
 * nothing would be worse than one that stated what it read.
 */
function requestUrl(request: Request): { readonly pathname: string; readonly search: string } {
  try {
    const url = new URL(request.url);

    return { pathname: url.pathname, search: url.search };
  } catch {
    return { pathname: request.url, search: "" };
  }
}

/** The request's headers, with every named one replaced by the literal. */
function captureHeaders(
  headers: Headers,
  redact: readonly string[],
): Readonly<Record<string, string>> {
  const captured: Record<string, string> = {};

  for (const [name, value] of headers) {
    // `Headers` iterates names lowercased, and the policy lowercased what it was
    // told to redact, so a header named in its canonical case is still matched.
    captured[name] = redact.includes(name) ? redactedValue : value;
  }

  return Object.freeze(captured);
}

/**
 * The body as an entry stores it, or `undefined` when the request carried none.
 *
 * A body the limit cut keeps its first `limit` characters and states that it was
 * cut: a record that silently dropped the rest would read as the whole body, and
 * one that stored nothing would lose the part a developer was looking for.
 *
 * A body this package cannot serialize — one that refers to itself, or one
 * carrying a `BigInt`, both of which `JSON.stringify` refuses — is stored as the
 * literal rather than left out, because `undefined` is reserved for the request
 * that carried nothing: a missing `body` would read as a request with no body,
 * which is a claim about the request rather than an absence to leave out. This
 * hook may not throw, and a throw here is a failed request, so the record states
 * what it could not read instead of failing the answer it describes.
 */
function captureBody(body: unknown, limit: number): string | undefined {
  if (typeof body === "string") {
    return body.length > limit ? `${body.slice(0, limit)}${truncatedMarker}` : body;
  }

  if (body === undefined || body === null) {
    return undefined;
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(body) ?? "";
  } catch {
    return unserializableMarker;
  }

  return serialized.length > limit ? `${serialized.slice(0, limit)}${truncatedMarker}` : serialized;
}

/**
 * The status the answer went out with.
 *
 * `set.status` is what Elysia resolved for every answer it composed, so a status
 * named in the options is a number by the time this runs. The exception is an
 * answer a handler built itself: Elysia leaves `set.status` at the default while
 * the client receives the status that `Response` carries, and the record states
 * the one the client received. The last fallback is a guard rather than a case a
 * probe reached — a status that is not a number and an answer that carries none
 * together leave nothing to read, and `200` is what an answer with no status of
 * its own states.
 */
function answerStatus(context: AnsweredRequest): number {
  if (context.answer instanceof Response) {
    return context.answer.status;
  }

  return typeof context.status === "number" ? context.status : 200;
}

/**
 * The message the answer published, or `undefined` when there is none to read.
 *
 * A `5xx` is the whole test: a `4xx` is an answer rather than a failure, so a
 * validation `422`, a `404`, and an `HttpError` a route threw on purpose all
 * carry no `error`. The message is read from the answer and never from the
 * context's `error`, because this package registers no error hooks and an
 * exception's message is written for whoever reads the log, not for whoever reads
 * the record — it is reported where it always was, under `ExceptionsHandler` in
 * the log stream `/logs` serves.
 *
 * Two failures publish a message this hook cannot reach, and both state the
 * absence rather than repeat the exception: the platform's own mapping for an
 * unhandled failure, which answers with a `Response` Elysia does not store on the
 * context, and an answer a handler built itself, whose body is the one the client
 * already holds.
 */
async function failureMessage(status: number, answer: unknown): Promise<string | undefined> {
  if (status < 500) {
    return undefined;
  }

  const published = await publishedBody(answer);
  const detail = (published as { readonly detail?: unknown } | null | undefined)?.detail;

  return typeof detail === "string" ? detail : undefined;
}

/** The answer's body as JSON, or `undefined` when it cannot be read from here. */
async function publishedBody(answer: unknown): Promise<unknown> {
  if (!(answer instanceof Response)) {
    return answer;
  }

  try {
    return await answer.clone().json();
  } catch {
    // The body is already disturbed — a `Response` the handler built is the one
    // the client was handed — or the answer is not JSON at all. Either way there
    // is no published message to read here.
    return undefined;
  }
}
