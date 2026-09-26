import type { LoggerService } from "@aponiajs/common";
import { ElysiaCustomStatusResponse } from "elysia";
import type { ResolvedFilter } from "../controllers/enhancer-resolver.ts";
import type { ElysiaErrorHook } from "../routing/route-compiler.types.ts";
import { HttpError, httpErrors } from "./http-error.ts";

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
 * It answers an `HttpError` with that error's own Problem Details response, and
 * every other unhandled failure with a `500` Problem Details response. Neither
 * carries the stack or the cause: an application that could turn this off could
 * ship a stack trace, so it is always present and never removable, and an
 * application overrides it by declaring a filter ahead of it.
 *
 * What it does not answer is everything that already states a response of its
 * own, which keeps the platform's native behavior for exactly the failures that
 * have one: Elysia's own framework errors (validation, parsing, not-found, the
 * cookie and file-type rejections), the `status()` escape hatch, and any
 * exception carrying a `toResponse()`. Those reach the client through Elysia's
 * own error path, unchanged, because a mapping that answered them first would
 * replace a validation `422` with a `500` and a thrown `status()` with one.
 *
 * The system logger receives the exception it maps, so an unhandled failure is
 * still reported where an application reads its logs. The parameter is required
 * so a boot that compiled the mapping states the logger it reports to, and
 * `undefined` is that statement for an application that disabled logging.
 *
 * @internal
 */
export function createDefaultExceptionFilter(logger: LoggerService | undefined): ElysiaErrorHook {
  return ({ error }) => {
    if (error instanceof HttpError) {
      return error.toResponse();
    }
    if (statesItsOwnAnswer(error)) {
      return undefined;
    }

    logger?.error(error, "ExceptionsHandler");
    return httpErrors.internalServerError(unhandledFailureDetail).toResponse();
  };
}

/**
 * Whether Elysia's own error path already answers this exception.
 *
 * Two of the three checks are structural because they describe a contract
 * rather than a version: an exception that carries a numeric `status` states
 * the status it answers with, and one that carries a `toResponse()` states the
 * response itself. Together they cover every framework error Elysia throws —
 * `ValidationError` and `InvalidFileType` answer `422`, `ParseError` and
 * `InvalidCookieSignature` `400`, `NotFoundError` `404`, `InternalServerError`
 * `500` — and every application exception written against Elysia's own
 * documented custom-error shape.
 *
 * The `status()` escape hatch is checked by class because it is the one of the
 * three that states neither: it carries the code it was built with.
 */
function statesItsOwnAnswer(error: unknown): boolean {
  if (error instanceof ElysiaCustomStatusResponse) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const answer = error as { readonly status?: unknown; readonly toResponse?: unknown };
  return typeof answer.status === "number" || typeof answer.toResponse === "function";
}
