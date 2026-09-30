import { renderLogValue, type LoggerService } from "@aponiajs/common";
import { ElysiaStatus } from "elysia";
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
 * off could ship a stack trace, so it is always present and never removable, and
 * an application overrides it by declaring a filter ahead of it. It is a
 * route-local hook, and Elysia reads a route's own `error` array under every
 * configuration this release can select, so the mapping and the filters beside
 * it run whenever the route does.
 *
 * It answers only what Elysia would otherwise answer from its unknown-error
 * fallback. Everything Elysia's own error path decides for itself is declined
 * and reaches the client unchanged — an `HttpError`, Elysia's validation,
 * parse, and status-bearing errors, a thrown `status()`, and a transform decode
 * failure — because a mapping that answered those first would replace a
 * deliberate `422`, `400`, `404`, or Problem Details response with a `500`.
 *
 * The system logger receives the exception it maps, so an unhandled failure is
 * still reported where an application reads its logs. The call is guarded, and a
 * logger that refuses is reported on `stderr` instead: `LoggerService` is a
 * public interface an application implements, so a throw is not this mapping's
 * to depend on, and the response above is not the logger's to replace. The
 * parameter is required so a boot that compiled the mapping states the logger it
 * reports to, and `undefined` is that statement for an application that disabled
 * logging.
 *
 * `mappedExceptions` is where this mapping records the exception it answered, for
 * a reader that cannot see the answer: the `Response` it returns is not on the
 * after-response context, so a consumer reporting what a request received — the
 * devtools `/requests` record — would otherwise state that an unhandled failure
 * said nothing at all. It is keyed by the request object, which the after-response
 * hook carries. Recording is the mapping's whole second job here: it writes to a
 * `WeakMap` and returns what it always returned, because a hook in Elysia's error
 * path that could change which handler answers would be a different answer rather
 * than a report of one.
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

    // The record is the only place `/requests` can read this failure's message
    // from, because the `Response` below is not on the after-response context. The
    // logger call is guarded, which is what keeps a throw out of a hook whose
    // return value is the client's answer — see `reportThroughLogger`.
    recordMappedException(mappedExceptions, request, error);
    reportThroughLogger(logger, error, "ExceptionsHandler");
    return httpErrors.internalServerError(unhandledFailureDetail).toResponse();
  };
}

/**
 * Reports a failure through the application's logger, and never lets the logger's
 * own failure replace the failure being reported.
 *
 * `LoggerService` is a public interface and an application's implementation of it
 * may throw, so the framework may not read a call as a promise the interface
 * makes. The rule this holds to is narrow on purpose: a call site that reports a
 * failure guards, and a call site that reports progress does not. A throw on a
 * progress line aborts work that has not yet reported a failure, and that is
 * louder than continuing — which is why the boot's `logger.log(...)` lines are
 * left unguarded.
 *
 * Four call sites in this package report a failure, and every one of them needs
 * this:
 *
 * - the default Problem Details mapping below, whose hook's return value is the
 *   client's answer, so a throw there would replace the application's Problem
 *   Details response with the engine's own page;
 * - `createFilterHook`'s catch in `routing/route-compiler.ts`, where a throw would
 *   reject the route's `error` hook and cost the same answer that filter's decline
 *   exists to preserve;
 * - `listen`'s catch in `application/aponia-elysia-application.ts`, where a throw
 *   would replace the engine's failure the caller is about to be handed;
 * - `runShutdownHooks`'s catch in `application-bootstrap.ts`, where a throw would
 *   stop every remaining shutdown hook from running at all, so one pool that
 *   refused to close would leave every other pool open.
 *
 * `packages/devtools`'s one failure row — the route analysis it could not read
 * — is the framework's other site of that
 * kind, and it guards in place, through that package's own
 * `logging/report-failure.ts`, rather than through this function: this seam is
 * `@internal` and off this package's barrel, so another package cannot call it.
 *
 * The built-in logger no longer refuses any value, which is why this guard is not
 * the whole story — it is the half that holds for a logger this framework did not
 * build.
 *
 * A logger that refuses is reported rather than swallowed, on `stderr` by a direct
 * write, because the channel that would normally carry the diagnostic is the one
 * that just failed. This is the only place this package writes a process stream,
 * and the layering cost is real — logging is `common`'s domain — and it is
 * accepted because the alternative is a logger that is broken and invisible.
 *
 * `context` is required rather than defaulted because it is the subsystem each
 * call site already reported under, and the announcement below repeats it.
 *
 * @internal
 */
export function reportThroughLogger(
  logger: LoggerService | undefined,
  failure: unknown,
  context: string,
): void {
  try {
    logger?.error(failure, context);
  } catch (loggerFailure) {
    announceLoggerFailure(loggerFailure, context);
  }
}

/**
 * States a logger's own failure where a reader will see it.
 *
 * Guarded for the same reason the call above is: an application can be writing to
 * a closed stream, and a throw out of this one would leave the failing call site
 * with nothing at all — the outcome this whole path exists to prevent. A stderr
 * write that refuses leaves nothing further to report to, so the absence is
 * accepted at the last line rather than taken out on the caller's answer.
 */
function announceLoggerFailure(loggerFailure: unknown, context: string): void {
  try {
    process.stderr.write(
      `[Aponia] ${process.pid} - ERROR [${context}] the configured logger threw while ` +
        `reporting a failure: ${renderLogValue(loggerFailure)}\n`,
    );
  } catch {
    // Nothing left to report to.
  }
}

/**
 * Records the exception this mapping answered, so a reader that cannot see the
 * answer can state it.
 *
 * What goes in the map is the exception, not the sentence this mapping answered
 * with: the response body is one fixed `detail` for every unhandled failure, and
 * repeating that sentence would tell a consumer nothing the status does not. The
 * value is therefore the exception's own account, which is what the
 * record's field is named for — `mappedExceptions`, keyed by the request the
 * mapping saw.
 *
 * The rendering is `@aponiajs/common`'s `renderLogValue`, the same call the
 * devtools log stream renders a line through, so `/requests` and `/logs` cannot
 * disagree about one failure and the literal a value that refuses everything is
 * stated as is the same word on both. It is total, which is why it may be called
 * here at all: this runs inside a route-local `error` hook whose return value is
 * the response, and this call is not guarded — a throw out of it would leave the
 * hook and replace the application's Problem Details answer with the engine's own
 * page. The logger call below runs the same rendering through this package's
 * guard, so a refusal there is announced on `stderr` instead of escaping the
 * hook. The record is written above that call because it costs nothing and
 * depends on no guard; the placement protects nothing, and it is the guard alone
 * that leaves the record and the Problem Details answer standing.
 */
function recordMappedException(
  mappedExceptions: WeakMap<Request, string>,
  request: Request,
  error: unknown,
): void {
  mappedExceptions.set(request, renderLogValue(error));
}

/**
 * Whether Elysia's own error path answers this exception itself.
 *
 * Three of the checks are structural because they describe a contract rather
 * than a version: an exception carrying a numeric `status` is one Elysia seeds
 * the response status from, one exposing `toResponse()` is answered through
 * that response, and an `ElysiaStatus` is the `status()` escape
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
  if (error instanceof ElysiaStatus) {
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
