import type { InvertedStatusMap, StatusMap } from "elysia";
import type { HttpError } from "./http-error.ts";

type HttpErrorStatusCodeFrom<TStatus extends number> = `${TStatus}` extends
  | `4${string}`
  | `5${string}`
  ? TStatus
  : never;

export type HttpErrorStatusCode = {
  [TStatus in keyof InvertedStatusMap]: TStatus extends number
    ? HttpErrorStatusCodeFrom<TStatus>
    : never;
}[keyof InvertedStatusMap];

export type HttpErrorStatusName = InvertedStatusMap[HttpErrorStatusCode];

export type HttpErrorStatus = HttpErrorStatusCode | HttpErrorStatusName;

export type ResolveHttpErrorStatus<TStatus extends HttpErrorStatus> =
  TStatus extends keyof StatusMap
    ? StatusMap[TStatus]
    : TStatus extends HttpErrorStatusCode
      ? TStatus
      : never;

export interface ProblemDetails<TStatus extends HttpErrorStatusCode = HttpErrorStatusCode> {
  readonly type: string;
  readonly title: string;
  readonly status: TStatus;
  readonly detail: string;
  readonly instance?: string;
  readonly code: string;
  readonly [extension: string]: unknown;
}

export interface HttpErrorOptions {
  readonly detail?: string;
  readonly code?: string;
  readonly type?: string;
  readonly instance?: string;
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export type HttpErrorFactory<TStatus extends HttpErrorStatusName> = {
  (detail?: string, options?: Omit<HttpErrorOptions, "detail">): HttpError<TStatus>;
  (options?: HttpErrorOptions): HttpError<TStatus>;
};
