import {
  AponiaError,
  getControllerMetadata,
  isRouteResponseSchemaMap,
  resolveRouteValidator,
  type ClassToken,
  type ConfigurationToken,
  type RouteValidatorInput,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { compileRoutes } from "@aponiajs/platform-core";
import type {
  OpenApiConfiguration,
  OpenApiInfo,
} from "../interfaces/openapi-document.interface.ts";

/** The methods the served document omits, whatever the application mounts. */
const excludedMethods: ReadonlySet<string> = new Set(["ALL", "OPTIONS", "HEAD"]);

/** One parameter, as an OpenAPI operation states it. */
export interface OpenApiParameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly schema: unknown;
}

/** One operation, as this package writes it. */
export interface OpenApiOperation {
  readonly operationId: string;
  readonly parameters: readonly OpenApiParameter[];
  readonly requestBody?: {
    readonly required: boolean;
    readonly content: Readonly<Record<string, { readonly schema: unknown }>>;
  };
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
  readonly deprecated?: boolean;
}

interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, { readonly schema: unknown }>>;
}

/** The document this package serves. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: OpenApiInfo;
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
}

/**
 * Builds the document from the routes the application declared.
 *
 * Only compiled plans are described: a controller mounted through a
 * registration callback has no route plan to read, and a WebSocket gateway is
 * not an HTTP operation.
 *
 * @internal
 */
export function buildOpenApiDocument(
  container: AponiaContainer,
  info: OpenApiInfo,
  mountPath: string,
): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  for (const module of container.graph.modules) {
    for (const definition of module.controllers) {
      const token = definition.token as ClassToken<unknown>;
      const metadata = getControllerMetadata(token);
      if (metadata === undefined) {
        continue;
      }
      for (const route of compileRoutes(token, metadata.path)) {
        if (excludedMethods.has(route.method) || route.path.startsWith(mountPath)) {
          continue;
        }
        const path = toOpenApiPath(route.path);
        const operation = buildOperation(route, path);
        (paths[path] ??= {})[route.method.toLowerCase()] = operation;
      }
    }
  }

  return Object.freeze({
    openapi: "3.1.0",
    info,
    paths: Object.freeze(paths),
    components: Object.freeze({ schemas: Object.freeze({}) }),
  });
}

function buildOperation(
  route: ReturnType<typeof compileRoutes>[number],
  path: string,
): OpenApiOperation {
  const parameters: OpenApiParameter[] = [];
  const schema = route.schema;

  parameters.push(...containerParameters(schema?.params, "path", pathParameters(path)));
  parameters.push(...containerParameters(schema?.query, "query"));
  parameters.push(...containerParameters(schema?.headers, "header"));
  parameters.push(...containerParameters(schema?.cookie, "cookie"));

  const body = schema?.body === undefined ? undefined : toJsonSchema(schema.body);
  const responses = responseSchemas(schema?.response, route.httpCode);

  return Object.freeze({
    operationId: operationIdOf(route.method, path),
    parameters: Object.freeze(parameters),
    ...(body === undefined
      ? {}
      : {
          requestBody: Object.freeze({
            required: true,
            content: Object.freeze({ "application/json": Object.freeze({ schema: body }) }),
          }),
        }),
    responses,
    ...(route.deprecation === undefined ? {} : { deprecated: true }),
  });
}

function responseSchemas(
  response: unknown,
  httpCode: number | undefined,
): Readonly<Record<string, OpenApiResponse>> {
  if (response === undefined) {
    return Object.freeze({
      [String(httpCode ?? 200)]: Object.freeze({ description: "The route's answer." }),
    });
  }
  if (isRouteResponseSchemaMap(response as never)) {
    const map: Record<string, OpenApiResponse> = {};
    for (const [status, validator] of Object.entries(response as Record<string, unknown>)) {
      map[status] = Object.freeze({
        description: `The ${status} answer.`,
        content: Object.freeze({
          "application/json": Object.freeze({ schema: toJsonSchema(validator as never) }),
        }),
      });
    }
    return Object.freeze(map);
  }
  return Object.freeze({
    [String(httpCode ?? 200)]: Object.freeze({
      description: "The route's answer.",
      content: Object.freeze({
        "application/json": Object.freeze({ schema: toJsonSchema(response as never) }),
      }),
    }),
  });
}

function containerParameters(
  validator: RouteValidatorInput | undefined,
  location: string,
  fallback: readonly string[] = [],
): OpenApiParameter[] {
  if (validator === undefined) {
    return fallback.map((name) =>
      Object.freeze({ name, in: location, required: true, schema: { type: "string" } }),
    );
  }
  const json = toJsonSchema(validator) as {
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
  const properties = json.properties ?? {};
  const required = new Set(json.required ?? []);
  return Object.entries(properties).map(([name, parameterSchema]) =>
    Object.freeze({
      name,
      in: location,
      required: required.has(name) || location === "path",
      schema: parameterSchema,
    }),
  );
}

function toJsonSchema(validator: RouteValidatorInput): unknown {
  const resolved = resolveRouteValidator(validator) as unknown;
  if (typeof resolved === "object" && resolved !== null) {
    const standard = (
      resolved as {
        readonly "~standard"?: { readonly jsonSchema?: { input?: () => unknown } };
      }
    )["~standard"];
    if (standard?.jsonSchema?.input !== undefined) {
      return stripMeta(standard.jsonSchema.input());
    }
    const clone = JSON.parse(JSON.stringify(resolved)) as Record<string, unknown>;
    delete clone["~standard"];
    delete clone["$schema"];
    return Object.freeze(clone);
  }
  return Object.freeze({});
}

function stripMeta(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  delete clone["$schema"];
  return clone;
}

function pathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
}

function toOpenApiPath(path: string): string {
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return normalized.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function operationIdOf(method: string, path: string): string {
  const words = path
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => segment.replace(/[{}:]/g, ""))
    .map((segment) =>
      segment.replace(/[^A-Za-z0-9]+(.)?/g, (_m, next: string | undefined) =>
        next === undefined ? "" : next.toUpperCase(),
      ),
    )
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`);
  return `${method.toLowerCase()}${words.join("")}`;
}

/**
 * The metadata, read from the value a configuration validated into.
 *
 * A guard rather than a cast: a `defineConfiguration` transform is arbitrary
 * JavaScript, so a document a client generator will trust is only served from a
 * value this package checked. Every failing field is reported at once.
 *
 * @internal
 */
export function readOpenApiInfo<TSourceValue>(
  value: TSourceValue,
  configuration: ConfigurationToken<OpenApiConfiguration>,
): OpenApiInfo {
  const name = configuration.description;
  const info = (value as { readonly info?: unknown } | null | undefined)?.info;

  if (typeof info !== "object" || info === null) {
    throw invalidConfigurationValue(name, [
      '"info" must be an object stating the document title and version',
    ]);
  }

  const issues = readInfoIssues(info as RawInfo);

  if (issues.length > 0) {
    throw invalidConfigurationValue(name, issues);
  }

  const checked = info as RawInfo;

  return Object.freeze({
    title: checked.title as string,
    version: checked.version as string,
    description: typeof checked.description === "string" ? checked.description : undefined,
  });
}

interface RawInfo {
  readonly title?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
}

function readInfoIssues(info: RawInfo): string[] {
  const issues: string[] = [];

  if (!isNonEmptyString(info.title)) {
    issues.push('"info.title" must be a non-empty string');
  }

  if (!isNonEmptyString(info.version)) {
    issues.push('"info.version" must be a non-empty string');
  }

  if (info.description !== undefined && typeof info.description !== "string") {
    issues.push('"info.description" must be a string when it is present');
  }

  return issues;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidConfigurationValue(name: string, issues: readonly string[]): AponiaError {
  return new AponiaError(
    "INVALID_CONFIGURATION_VALUE",
    `Configuration "${name}" is not a valid OpenAPI document configuration.`,
    { configuration: name, issues: Object.freeze([...issues]) },
  );
}
