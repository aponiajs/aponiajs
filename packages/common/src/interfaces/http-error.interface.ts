import type { httpStatusCodes, HttpStatusReasonName } from "../exceptions/http-status-map.ts";
import type { HttpError } from "../exceptions/http-error.ts";

/** A 4xx or 5xx status code this framework answers with. */
export type HttpErrorStatusCode = {
  [TName in HttpStatusReasonName]: `${(typeof httpStatusCodes)[TName]}` extends
    | `4${string}`
    | `5${string}`
    ? (typeof httpStatusCodes)[TName]
    : never;
}[HttpStatusReasonName];

/** A 4xx or 5xx status name this framework answers with. */
export type HttpErrorStatusName = {
  [TName in HttpStatusReasonName]: (typeof httpStatusCodes)[TName] extends HttpErrorStatusCode
    ? TName
    : never;
}[HttpStatusReasonName];

/** A status an `HttpError` answers with: a code or a name. */
export type HttpErrorStatus = HttpErrorStatusCode | HttpErrorStatusName;

/** The numeric status a code or name resolves to. */
export type ResolveHttpErrorStatus<TStatus extends HttpErrorStatus> =
  TStatus extends HttpErrorStatusName
    ? (typeof httpStatusCodes)[TStatus]
    : TStatus extends HttpErrorStatusCode
      ? TStatus
      : never;

/** The RFC 9457 problem body an `HttpError` serializes, without stack or cause. */
export interface ProblemDetails<TStatus extends HttpErrorStatusCode = HttpErrorStatusCode> {
  readonly type: string;
  readonly title: string;
  readonly status: TStatus;
  readonly detail: string;
  readonly instance?: string;
  readonly code: string;
  readonly [extension: string]: unknown;
}

/** The options an `HttpError` is built with: detail, code, type, instance, headers, and extensions. */
export interface HttpErrorOptions {
  readonly detail?: string;
  readonly code?: string;
  readonly type?: string;
  readonly instance?: string;
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/** One named factory of the frozen `httpErrors` set, for a single status. */
export type HttpErrorFactory<TStatus extends HttpErrorStatusName> = {
  (detail?: string, options?: Omit<HttpErrorOptions, "detail">): HttpError<TStatus>;
  (options?: HttpErrorOptions): HttpError<TStatus>;
};
