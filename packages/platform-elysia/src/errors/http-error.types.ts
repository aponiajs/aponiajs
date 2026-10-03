import type { StatusMap, StatusMapBack } from "elysia";
import type { HttpError } from "./http-error.ts";

type HttpErrorStatusCodeFrom<TStatus extends number> = `${TStatus}` extends
  | `4${string}`
  | `5${string}`
  ? TStatus
  : never;

/** A 4xx or 5xx status code from Elysia's supported status map. */
export type HttpErrorStatusCode = {
  [TStatus in keyof StatusMapBack]: TStatus extends number
    ? HttpErrorStatusCodeFrom<TStatus>
    : never;
}[keyof StatusMapBack];

/** A 4xx or 5xx status name from Elysia's supported status map. */
export type HttpErrorStatusName = StatusMapBack[HttpErrorStatusCode];

/** A status an `HttpError` answers with: a code or a name. */
export type HttpErrorStatus = HttpErrorStatusCode | HttpErrorStatusName;

/** The numeric status a code or name resolves to. */
export type ResolveHttpErrorStatus<TStatus extends HttpErrorStatus> =
  TStatus extends keyof StatusMap
    ? StatusMap[TStatus]
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
