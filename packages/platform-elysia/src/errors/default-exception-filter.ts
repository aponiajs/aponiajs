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
 * The literal a thrown value this release cannot project at all is stated as.
 *
 * The devtools log stream restates it, with the projection below, in
 * `packages/devtools/src/logging/log-tap.ts`: the message `/requests` publishes
 * for an unhandled failure is compared against the line `/logs` states for it, so
 * a value neither surface can project has to read the same on both. The two
 * packages do not depend on each other, so the constant and the branches of the
 * projection are kept in step by hand and held by
 * `packages/devtools/tests/requests.test.ts`.
 */
const unprojectableValue = "[unprojectable]";

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

    // The record is written before the logger is called, and the call is guarded.
    // The record is the only place `/requests` can read this failure's message
    // from, because the `Response` below is not on the after-response context, and
    // the guard is what keeps a throw out of a hook whose return value is the
    // client's answer — see `reportUnhandledFailure`.
    recordMappedException(mappedExceptions, request, error);
    reportUnhandledFailure(logger, error);
    return httpErrors.internalServerError(unhandledFailureDetail).toResponse();
  };
}

/**
 * Reports an unhandled failure through the application's logger, and never lets
 * the logger's own failure become the client's answer.
 *
 * `LoggerService` is a public interface and an application's implementation of it
 * may throw, so the framework may not read a call as a promise the interface
 * makes. This is the one call site where that costs an answer: the hook this runs
 * in returns the response the client receives, so a throw here would replace the
 * application's Problem Details answer with the engine's own page. The built-in
 * logger no longer refuses any value, which is why this guard is not the whole
 * story — it is the half that holds for a logger this framework did not build.
 *
 * A logger that refuses is reported rather than swallowed, on `stderr` by a direct
 * write, because the channel that would normally carry the diagnostic is the one
 * that just failed. This is the only place this package writes a process stream,
 * and the layering cost is real — logging is `common`'s domain — and it is
 * accepted because the alternative is a logger that is broken and invisible.
 */
function reportUnhandledFailure(logger: LoggerService | undefined, error: unknown): void {
  try {
    logger?.error(error, "ExceptionsHandler");
  } catch (loggerFailure) {
    announceLoggerFailure(loggerFailure);
  }
}

/**
 * States a logger's own failure where a reader will see it.
 *
 * Guarded for the same reason the call above is: an application can be writing to
 * a closed stream, and a throw out of this one would leave the error hook with no
 * response at all — the outcome this whole path exists to prevent. A stderr write
 * that refuses leaves nothing further to report to, so the absence is accepted at
 * the last line rather than taken out on the client's answer.
 */
function announceLoggerFailure(loggerFailure: unknown): void {
  try {
    process.stderr.write(
      `[Aponia] ${process.pid} - ERROR [ExceptionsHandler] the configured logger threw while ` +
        `reporting an unhandled failure: ${exceptionMessage(loggerFailure)}\n`,
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
 * value is therefore the exception's own one-line account, which is what the
 * record's field is named for — `mappedExceptions`, keyed by the request the
 * mapping saw.
 *
 * The projection is the devtools log stream's own, restated here branch for
 * branch rather than shared because the two live in packages that do not depend
 * on each other. Restating it in full is the point: `/requests` compares its
 * entry against the line `/logs` states for the same exception, so a branch that
 * differed would make the two surfaces disagree about one failure, and the
 * devtools cases that throw a value per branch are what hold them together.
 *
 * It is also the reason this projection may not throw. The mapping writes this map
 * and then calls `logger.error(...)`, which runs the same projection through the
 * devtools tap, all inside a route-local `error` hook: a throw here would leave
 * the hook and replace this mapping's Problem Details response with the engine's
 * own page. The write comes first for that reason too: a logger that throws as it
 * reports the failure would otherwise cost `/requests` the fact together with the
 * answer, and the record is the only place that fact can come from. A value that
 * refuses both `JSON.stringify` and the plain string form is stated as a literal
 * rather than allowed to throw.
 */
function recordMappedException(
  mappedExceptions: WeakMap<Request, string>,
  request: Request,
  error: unknown,
): void {
  mappedExceptions.set(request, exceptionMessage(error));
}

/** The one-line account of a thrown value, which never throws whatever it is handed. */
function exceptionMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  try {
    if (typeof error === "function") {
      return error.name || "(anonymous)";
    }
    if (error instanceof Error) {
      // The name and the message, never the stack: a stack describes the internals
      // of the running application, and a record a page reads is no place for one.
      return `${error.name}: ${error.message}`;
    }

    return JSON.stringify(error) ?? String(error);
  } catch {
    // Every read above can refuse, and the ones that were noticed first are not
    // the only ones that can: `JSON.stringify` refuses a value that refers to
    // itself or whose `toJSON` throws, `instanceof` refuses a `Proxy` whose
    // `getPrototypeOf` throws, and the `name` of a function refuses when it is a
    // getter that throws. The whole body is guarded rather than the reads that
    // were thought of, so this holds for the next shape too. `String` is tried
    // once more on its own, because a value that refused only `JSON.stringify`
    // still has a plain form worth stating.
    return plainString(error);
  }
}

/**
 * The plain string form of a value, or the literal when even that refuses.
 *
 * This is the last read the projection makes, and it is guarded on its own
 * because a value can refuse the plain string form as readily as it refused
 * everything before it. A value whose `toPrimitive` or `toString` throws is a
 * value this release cannot state, and saying so in a literal is the honest
 * account where a throw is a different answer rather than a report of one.
 */
function plainString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return unprojectableValue;
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
