import type { LoggerService } from "@aponiajs/common";
import { ElysiaCustomStatusResponse } from "elysia";
import type { ResolvedFilter } from "../controllers/enhancer-resolver.ts";
import type { ElysiaErrorHook } from "../routing/route-compiler.types.ts";
import { httpErrors } from "./http-error.ts";

/**
 * What an unhandled failure answers with.
 *
 * The same sentence for every one of them: the thrown value is not repeated to
 * the client, because an exception message is written for whoever reads the
 * log, not for whoever sent the request.
 */
const unhandledFailureDetail = "The server could not complete this request.";

/**
 * Whether one resolved filter answers one thrown value.
 *
 * A filter declared with no `@Catch()` arguments answers anything, which is
 * what an empty list of caught types means. Otherwise the thrown value is
 * matched against the declared types by `instanceof`, as Nest matches them.
 *
 * The types are read off the resolution rather than the filter class, so the
 * metadata `@Catch()` recorded was read once while the controller mounted and
 * is never re-read per request.
 *
 * @internal
 */
export function isFilterMatch(filter: ResolvedFilter, exception: unknown): boolean {
  if (filter.catch.length === 0) {
    return true;
  }

  return filter.catch.some((exceptionClass) => exception instanceof exceptionClass);
}

/**
 * The mapping every route carries last in its own `error` array.
 *
 * It answers an unhandled failure with a `500` Problem Details response that
 * carries neither the stack nor the cause: an application that could turn this
 * off could ship a stack trace, so on Elysia's AOT path it is always present and
 * never removable, and an application overrides it by declaring a filter ahead
 * of it. It is a route-local hook, and Elysia's dynamic dispatcher
 * (`elysia: { aot: false }`) never reads a route's own `error` array: that path
 * runs no declared filter and no mapping, and answers an unhandled failure with
 * Elysia's native `500` carrying the exception's message, which is why
 * `bootstrapAponiaApplication` warns about the policy at boot.
 *
 * It answers only what Elysia would otherwise answer from its unknown-error
 * fallback. Everything Elysia's own error path decides for itself is declined
 * and reaches the client unchanged — an `HttpError`, Elysia's validation,
 * parse, and status-bearing errors, a thrown `status()`, and a transform decode
 * failure — because a mapping that answered those first would replace a
 * deliberate `422`, `400`, `404`, or Problem Details response with a `500`.
 *
 * The system logger receives the exception it maps, so an unhandled failure is
 * still reported where an application reads its logs. The parameter is required
 * so a boot that compiled the mapping states the logger it reports to, and
 * `undefined` is that statement for an application that disabled logging.
 *
 * `mappedExceptions` is where the message this mapping answered with is recorded
 * for a reader that cannot see the answer: the `Response` it returns is not on
 * the after-response context, so a consumer reporting what a request received —
 * the devtools `/requests` record — would otherwise state that an unhandled
 * failure said nothing at all. It is keyed by the request object, which the
 * after-response hook carries. Recording is the mapping's whole second job here:
 * it writes to a `WeakMap` and returns what it always returned, because a hook
 * in Elysia's error path that could change which handler answers would be a
 * different answer rather than a report of one.
 *
 * @internal
 */
export function createDefaultExceptionFilter(
  logger: LoggerService | undefined,
  mappedExceptions: WeakMap<Request, string>,
): ElysiaErrorHook {
  return ({ error, request, set }) => {
    if (elysiaAnswersThis(error, set.status)) {
      return undefined;
    }

    logger?.error(error, "ExceptionsHandler");
    recordMappedException(mappedExceptions, request, error);
    return httpErrors.internalServerError(unhandledFailureDetail).toResponse();
  };
}

/**
 * Records the account this mapping answered with, or leaves it unrecorded when
 * the thrown value cannot be projected at all.
 *
 * The projection is the devtools log stream's own, restated here rather than
 * shared because the two live in packages that do not depend on each other. It
 * is restated in full, branch for branch, and not only for its `Error` case: the
 * devtools `/requests` entry is compared against the line `/logs` states for the
 * same exception, so a value the two surfaces projected differently would make
 * that comparison hold for `Error`s alone while the sentence beside it promised
 * it for every exception.
 *
 * Nothing is recorded when the projection fails, because an absent message is
 * the truthful account of an exception this release cannot state, where a
 * stand-in literal would claim it said something. The projection is guarded for
 * the one outcome an observer in Elysia's error path may never cause: a throw
 * there takes the answer with it, and the client receives the engine's own page
 * instead of this mapping's Problem Details response. `JSON.stringify` refuses a
 * value that refers to itself and `String` refuses one whose `toPrimitive` or
 * `toString` does, so the guard covers a value that refuses both.
 */
function recordMappedException(
  mappedExceptions: WeakMap<Request, string>,
  request: Request,
  error: unknown,
): void {
  const message = exceptionMessage(error);

  if (message !== undefined) {
    mappedExceptions.set(request, message);
  }
}

/** The one-line account of a thrown value, or `undefined` when it refuses to be projected. */
function exceptionMessage(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "function") {
    return error.name || "(anonymous)";
  }
  if (error instanceof Error) {
    // The name and the message, never the stack: a stack describes the internals
    // of the running application, and a record a page reads is no place for one.
    return `${error.name}: ${error.message}`;
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return undefined;
  }
}

/**
 * Whether Elysia's own error path answers this exception itself.
 *
 * Three of the checks are structural because they describe a contract rather
 * than a version: an exception carrying a numeric `status` is one Elysia seeds
 * the response status from, one exposing `toResponse()` is answered through
 * that response, and an `ElysiaCustomStatusResponse` is the `status()` escape
 * hatch, which states neither and carries the status as its code. Together they
 * cover every framework error Elysia throws — `ValidationError` and
 * `InvalidFileType` answer `422`, `ParseError` and `InvalidCookieSignature`
 * `400`, `NotFoundError` `404`, `InternalServerError` `500` — every application
 * exception written against Elysia's documented custom-error shape, and
 * `HttpError`, which keeps answering through Elysia's native `toResponse()`
 * path exactly as it did before this mapping existed.
 *
 * The fourth check reads the status the response already carries, because the
 * thrown value does not always state one. Elysia only overwrites `set.status`
 * while it is unset or below `300`, so anything at or above `300` was decided
 * before this hook ran: by a handler that set it, or by Elysia's own transform
 * coercion, which answers a failed `t.Transform` decode with `422` and rethrows
 * the decode function's own error — a plain `Error` carrying neither a status
 * nor a `toResponse()`. `500` is excluded because it is the one status Elysia
 * falls back to for a failure it does not know, which is exactly the failure
 * this mapping exists for. A status name counts as decided by the same test,
 * because Elysia's own path applies the same one: it never overwrites a status
 * it finds (and never resolves a name either, so what a name answers is
 * Elysia's answer, not this mapping's to replace).
 */
function elysiaAnswersThis(error: unknown, status: unknown): boolean {
  if (error instanceof ElysiaCustomStatusResponse) {
    return true;
  }
  if (isDecidedStatus(status)) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const answer = error as { readonly status?: unknown; readonly toResponse?: unknown };
  return typeof answer.status === "number" || typeof answer.toResponse === "function";
}

/**
 * Whether the response status was already decided when the error reached the
 * hook.
 *
 * This is Elysia's own test, not a new one: its error path seeds the response
 * status from the exception, or leaves a status it finds in the context alone
 * while that status is set and not below `300`, and its unknown-error fallback
 * answers with whatever the context then carries. A number at or above `300`
 * other than the generic `500`, and any status name, therefore belong to an
 * answer already decided — by a handler or by a step of the request — rather
 * than to the fallback.
 */
function isDecidedStatus(status: unknown): boolean {
  if (typeof status === "number") {
    return status >= 300 && status !== 500;
  }

  return typeof status === "string";
}
