import { InvertedStatusMap, StatusMap } from "elysia";
import type {
  HttpErrorFactory,
  HttpErrorOptions,
  HttpErrorStatus,
  HttpErrorStatusCode,
  HttpErrorStatusName,
  ProblemDetails,
  ResolveHttpErrorStatus,
} from "./http-error.types.ts";

const defaultProblemType = "about:blank";
const reservedProblemMembers = new Set([
  "type",
  "title",
  "status",
  "detail",
  "instance",
  "code",
  "name",
  "message",
  "stack",
  "cause",
]);

const httpErrorDefinitions = [
  ["badRequest", "Bad Request"],
  ["unauthorized", "Unauthorized"],
  ["paymentRequired", "Payment Required"],
  ["forbidden", "Forbidden"],
  ["notFound", "Not Found"],
  ["methodNotAllowed", "Method Not Allowed"],
  ["notAcceptable", "Not Acceptable"],
  ["proxyAuthenticationRequired", "Proxy Authentication Required"],
  ["requestTimeout", "Request Timeout"],
  ["conflict", "Conflict"],
  ["gone", "Gone"],
  ["lengthRequired", "Length Required"],
  ["preconditionFailed", "Precondition Failed"],
  ["payloadTooLarge", "Payload Too Large"],
  ["uriTooLong", "URI Too Long"],
  ["unsupportedMediaType", "Unsupported Media Type"],
  ["rangeNotSatisfiable", "Range Not Satisfiable"],
  ["expectationFailed", "Expectation Failed"],
  ["imATeapot", "I'm a teapot"],
  ["enhanceYourCalm", "Enhance Your Calm"],
  ["misdirectedRequest", "Misdirected Request"],
  ["unprocessableContent", "Unprocessable Content"],
  ["locked", "Locked"],
  ["failedDependency", "Failed Dependency"],
  ["tooEarly", "Too Early"],
  ["upgradeRequired", "Upgrade Required"],
  ["preconditionRequired", "Precondition Required"],
  ["tooManyRequests", "Too Many Requests"],
  ["requestHeaderFieldsTooLarge", "Request Header Fields Too Large"],
  ["unavailableForLegalReasons", "Unavailable For Legal Reasons"],
  ["internalServerError", "Internal Server Error"],
  ["notImplemented", "Not Implemented"],
  ["badGateway", "Bad Gateway"],
  ["serviceUnavailable", "Service Unavailable"],
  ["gatewayTimeout", "Gateway Timeout"],
  ["httpVersionNotSupported", "HTTP Version Not Supported"],
  ["variantAlsoNegotiates", "Variant Also Negotiates"],
  ["insufficientStorage", "Insufficient Storage"],
  ["loopDetected", "Loop Detected"],
  ["notExtended", "Not Extended"],
  ["networkAuthenticationRequired", "Network Authentication Required"],
] as const satisfies readonly (readonly [string, HttpErrorStatusName])[];

type HttpErrorDefinition = (typeof httpErrorDefinitions)[number];

export type HttpErrorFactories = {
  readonly [TDefinition in HttpErrorDefinition as TDefinition[0]]: HttpErrorFactory<TDefinition[1]>;
};

export class HttpError<const TStatus extends HttpErrorStatus = HttpErrorStatus> extends Error {
  readonly status: ResolveHttpErrorStatus<TStatus>;
  readonly code: string;
  readonly problem: Readonly<ProblemDetails<ResolveHttpErrorStatus<TStatus>>>;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: TStatus, options: HttpErrorOptions = {}) {
    const resolved = resolveStatus(status);
    const detail = options.detail ?? resolved.title;
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = "HttpError";
    this.status = resolved.status as ResolveHttpErrorStatus<TStatus>;
    this.code = options.code ?? toErrorCode(resolved.title);
    this.headers = Object.freeze(Object.fromEntries(new Headers(options.headers)));
    this.problem = Object.freeze({
      type: options.type ?? defaultProblemType,
      title: resolved.title,
      status: this.status,
      detail,
      ...(options.instance === undefined ? {} : { instance: options.instance }),
      code: this.code,
      ...sanitizeExtensions(options.extensions),
    });
  }

  toResponse(): Response {
    const headers = new Headers(this.headers);
    headers.set("content-type", "application/problem+json");
    return new Response(JSON.stringify(this.problem), {
      status: this.status,
      headers,
    });
  }
}

export function httpError<const TStatus extends HttpErrorStatus>(
  status: TStatus,
  detail?: string,
  options?: Omit<HttpErrorOptions, "detail">,
): HttpError<TStatus>;
export function httpError<const TStatus extends HttpErrorStatus>(
  status: TStatus,
  options?: HttpErrorOptions,
): HttpError<TStatus>;
export function httpError<const TStatus extends HttpErrorStatus>(
  status: TStatus,
  detailOrOptions?: string | HttpErrorOptions,
  options: Omit<HttpErrorOptions, "detail"> = {},
): HttpError<TStatus> {
  return new HttpError(status, normalizeOptions(detailOrOptions, options));
}

export const httpErrors = Object.freeze(
  Object.fromEntries(
    httpErrorDefinitions.map(([name, status]) => [name, createHttpErrorFactory(status)]),
  ),
) as HttpErrorFactories;

function createHttpErrorFactory<TStatus extends HttpErrorStatusName>(
  status: TStatus,
): HttpErrorFactory<TStatus> {
  function createError(
    detail?: string,
    options?: Omit<HttpErrorOptions, "detail">,
  ): HttpError<TStatus>;
  function createError(options?: HttpErrorOptions): HttpError<TStatus>;
  function createError(
    detailOrOptions?: string | HttpErrorOptions,
    options: Omit<HttpErrorOptions, "detail"> = {},
  ): HttpError<TStatus> {
    return new HttpError(status, normalizeOptions(detailOrOptions, options));
  }

  return createError;
}

function normalizeOptions(
  detailOrOptions: string | HttpErrorOptions | undefined,
  options: Omit<HttpErrorOptions, "detail">,
): HttpErrorOptions {
  return typeof detailOrOptions === "string"
    ? { ...options, detail: detailOrOptions }
    : (detailOrOptions ?? {});
}

function sanitizeExtensions(
  extensions: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(extensions ?? {}).filter(([name]) => !reservedProblemMembers.has(name)),
  );
}

function resolveStatus(status: HttpErrorStatus): {
  readonly status: HttpErrorStatusCode;
  readonly title: HttpErrorStatusName;
} {
  const statusCode = typeof status === "number" ? status : StatusMap[status];
  const title = typeof status === "number" ? InvertedStatusMap[status] : status;
  if (title === undefined || statusCode < 400 || statusCode >= 600) {
    throw new TypeError(`HttpError requires a known 4xx or 5xx status; received ${status}.`);
  }

  return {
    status: statusCode as HttpErrorStatusCode,
    title: title as HttpErrorStatusName,
  };
}

function toErrorCode(title: string): string {
  return title
    .replaceAll(/['’]/g, "")
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/^_+|_+$/g, "")
    .toUpperCase();
}
