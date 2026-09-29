import { renderLogValue, type LoggerService } from "@aponiajs/common";
import { ElysiaStatus, ParseError, ValidationError } from "elysia";
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
 * off could expose a handler's error message. Elysia 2's route-local
 * filters run under both precompile policies.
 *
 * Elysia's validation and parse errors, thrown `status()` responses, and
 * exceptions with their own numeric status or `toResponse()` retain their
 * native responses. A handler that sets `set.status` and then throws a plain
 * Error is still mapped: beta.19 otherwise answers a 500 with that error's
 * message even when the earlier status is no longer applied.
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
  return ({ error, request }) => {
    if (elysiaAnswersThis(error)) {
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
 * A native `ElysiaStatus` or validation/parse error retains Elysia's response.
 * Application errors carrying their own numeric status or `toResponse()` also
 * retain it. A previously assigned `set.status` alone is not a safe response
 * decision after a handler throws on Elysia 2 beta.19.
 */
function elysiaAnswersThis(error: unknown): boolean {
  if (
    error instanceof ElysiaStatus ||
    error instanceof ValidationError ||
    error instanceof ParseError
  ) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const answer = error as { readonly status?: unknown; readonly toResponse?: unknown };
  return typeof answer.status === "number" || typeof answer.toResponse === "function";
}
