/** The application shape an adapter needs: one Request in, one Response out. */
export interface ServerlessApplication {
  handle(request: Request): Response | Promise<Response>;
}

/** The headers an API Gateway event carries, whichever payload version it uses. */
export interface LambdaHeaders {
  readonly [name: string]: string | undefined;
}

/**
 * An API Gateway HTTP API (payload 2.0) proxy event.
 *
 * Only the fields this adapter reads are declared; an event may carry more.
 */
export interface LambdaHttpEventV2 {
  readonly version: "2.0";
  readonly rawPath: string;
  readonly rawQueryString?: string;
  readonly cookies?: readonly string[];
  readonly headers?: LambdaHeaders;
  readonly requestContext: { readonly http: { readonly method: string } };
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
}

/**
 * An API Gateway REST API (payload 1.0) proxy event.
 *
 * Only the fields this adapter reads are declared; an event may carry more.
 */
export interface LambdaHttpEventV1 {
  readonly httpMethod: string;
  readonly path: string;
  readonly headers?: LambdaHeaders;
  readonly multiValueHeaders?: Readonly<Record<string, readonly string[] | undefined>>;
  readonly queryStringParameters?: LambdaHeaders;
  readonly multiValueQueryStringParameters?: Readonly<
    Record<string, readonly string[] | undefined>
  >;
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
}

/** Either proxy event version this adapter answers. */
export type LambdaHttpEvent = LambdaHttpEventV2 | LambdaHttpEventV1;

/** A payload 2.0 proxy result. */
export interface LambdaHttpResultV2 {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly cookies?: readonly string[];
  readonly body: string;
  readonly isBase64Encoded: boolean;
}

/** A payload 1.0 proxy result. */
export interface LambdaHttpResultV1 {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly multiValueHeaders?: Readonly<Record<string, readonly string[]>>;
  readonly body: string;
  readonly isBase64Encoded: boolean;
}

/** The result an adapter returns to API Gateway. */
export type LambdaHttpResult = LambdaHttpResultV2 | LambdaHttpResultV1;

/** The handler AWS Lambda invokes. */
export type LambdaHandler<TEvent extends LambdaHttpEvent = LambdaHttpEvent> = (
  event: TEvent,
  context?: unknown,
) => Promise<LambdaHttpResult>;
