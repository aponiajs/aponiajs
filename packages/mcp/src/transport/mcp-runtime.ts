import { AsyncLocalStorage } from "node:async_hooks";
import { AponiaError, createToken } from "@aponiajs/common";
import { getApplicationContainer, type ApplicationContainerRef } from "@aponiajs/core";
import {
  McpServer,
  ResourceTemplate,
  createMcpHandler,
  isCallToolResult,
  type McpRequestContext,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { McpPlan } from "../interfaces/mcp-plan.interface.ts";
import { buildMcpPlan } from "../discovery/mcp-discovery.ts";
import type { McpContext } from "../interfaces/mcp-context.interface.ts";
import { invokeMcpPrimitive, type McpContainer } from "../execution/mcp-invoker.ts";
import type { ResolvedMcpOptions } from "../interfaces/mcp-module.interface.ts";

const platformContext = new AsyncLocalStorage<unknown>();
const runtimeKey: unique symbol = Symbol.for("aponia.mcp.runtime");

const passthroughSchema = {
  "~standard": {
    version: 1,
    vendor: "aponia",
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: "object", additionalProperties: true }),
      output: () => ({ type: "object", additionalProperties: true }),
    },
  },
};

/** The runtime one registration built. @internal */
export const MCP_RUNTIME = createToken<McpRuntime>("aponia.mcp.runtime");

/** One boot's MCP plan, handler, and container. @internal */
export interface McpRuntime {
  readonly plan: McpPlan;
  readonly options: ResolvedMcpOptions;
  readonly container: McpContainer;
  readonly http: (request: Request, platform?: unknown, parsedBody?: unknown) => Promise<Response>;
  readonly close: () => Promise<void>;
}

/** Attaches one boot's MCP runtime to its native application. @internal */
export function attachMcpRuntime(application: object, runtime: McpRuntime): void {
  Object.defineProperty(application, runtimeKey, {
    value: runtime,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/** Reads the MCP runtime a boot produced. @internal */
export function readMcpRuntime(application: unknown): McpRuntime | undefined {
  const direct = (application as { [runtimeKey]?: McpRuntime } | null | undefined)?.[runtimeKey];
  if (direct !== undefined) {
    return direct;
  }

  const native = (
    application as { getNativeApplication?: () => unknown } | null | undefined
  )?.getNativeApplication?.();
  const container =
    getApplicationContainer(application) ??
    (native === undefined ? undefined : getApplicationContainer(native));
  if (container === undefined) {
    return undefined;
  }
  try {
    return container.get(MCP_RUNTIME) as McpRuntime;
  } catch {
    for (const module of container.graph.modules) {
      if (!module.providers.some((provider) => provider.provide === MCP_RUNTIME)) {
        continue;
      }
      return container.resolveModuleProvider(module, MCP_RUNTIME) as McpRuntime;
    }
    return undefined;
  }
}

/**
 * Builds the runtime from the boot's container reference.
 *
 * @internal
 */
export function createMcpRuntimeFromContainer(
  containerRef: ApplicationContainerRef,
  options: ResolvedMcpOptions,
): McpRuntime {
  if (containerRef.current === undefined) {
    throw new AponiaError(
      "INVALID_MCP_OPTIONS",
      "The MCP endpoint was constructed before its application's container existed.",
    );
  }
  return createMcpRuntime(containerRef.current as never, options);
}

/** Releases one runtime once, however many times a stop reaches it. @internal */
export class McpRuntimeShutdown {
  readonly #runtime: McpRuntime;
  #closed = false;

  constructor(runtime: McpRuntime) {
    this.#runtime = runtime;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#runtime.close();
  }
}

/**
 * Builds the plan and the per-request handler one mount serves.
 *
 * @internal
 */
export function createMcpRuntime(container: McpContainer, options: ResolvedMcpOptions): McpRuntime {
  const plan = buildMcpPlan(container as never, options);
  const handler = createMcpHandler(
    (requestContext) => buildServer(plan, container, options, requestContext),
    {
      legacy: options.legacy,
      responseMode: options.responseMode,
      maxRequestBodySize: options.maxRequestBodySize,
    },
  );

  return Object.freeze({
    plan,
    options,
    container,
    http: async (request: Request, platform?: unknown, parsedBody?: unknown) => {
      const refused = refuseRequest(request, options, parsedBody);
      if (refused !== undefined) {
        return refused;
      }
      return await platformContext.run(platform, () =>
        parsedBody === undefined ? handler.fetch(request) : handler.fetch(request, { parsedBody }),
      );
    },
    close: handler.close,
  });
}

/** Builds a fresh SDK server for one request or one stdio connection. */
export function buildServer(
  plan: McpPlan,
  container: McpContainer,
  options: ResolvedMcpOptions,
  requestContext: McpRequestContext,
): McpServer {
  const server = new McpServer(
    {
      name: options.name,
      version: options.version,
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.websiteUrl === undefined ? {} : { websiteUrl: options.websiteUrl }),
      ...(options.icons === undefined ? {} : { icons: options.icons as never }),
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    },
    { capabilities: {} },
  );
  const sdk = server as unknown as {
    registerTool(...arguments_: unknown[]): unknown;
    registerResource(...arguments_: unknown[]): unknown;
    registerPrompt(...arguments_: unknown[]): unknown;
  };

  for (const primitive of plan.tools) {
    sdk.registerTool(
      primitive.name,
      {
        ...(primitive.metadata.title === undefined ? {} : { title: primitive.metadata.title }),
        ...(primitive.metadata.description === undefined
          ? {}
          : { description: primitive.metadata.description }),
        inputSchema: (primitive.metadata.inputSchema ?? passthroughSchema) as never,
        ...(primitive.metadata.outputSchema === undefined
          ? {}
          : { outputSchema: primitive.metadata.outputSchema as never }),
        ...(primitive.metadata.annotations === undefined
          ? {}
          : { annotations: primitive.metadata.annotations as never }),
        ...(primitive.metadata.icons === undefined
          ? {}
          : { icons: primitive.metadata.icons as never }),
        ...(primitive.metadata.meta === undefined ? {} : { _meta: primitive.metadata.meta }),
      },
      (async (input: unknown, sdkContext: ServerContext) => {
        const call = callOf("tool", primitive.name, requestContext, sdkContext);
        try {
          const result = await invokeMcpPrimitive(primitive, container, input, call);
          return toolResult(result, primitive.metadata.outputSchema !== undefined);
        } catch (error) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: messageOf(error) }],
          };
        }
      }) as never,
    );
  }

  for (const primitive of plan.resources) {
    const uri = primitive.metadata.uri ?? primitive.name;
    sdk.registerResource(
      primitive.name,
      uri,
      {
        ...(primitive.metadata.title === undefined ? {} : { title: primitive.metadata.title }),
        ...(primitive.metadata.description === undefined
          ? {}
          : { description: primitive.metadata.description }),
        ...(primitive.metadata.mimeType === undefined
          ? {}
          : { mimeType: primitive.metadata.mimeType }),
        ...(primitive.metadata.size === undefined ? {} : { size: primitive.metadata.size }),
      },
      (async (readUri: URL, sdkContext: ServerContext) => {
        const call = callOf("resource", primitive.name, requestContext, sdkContext, readUri.href);
        const result = await invokeMcpPrimitive(primitive, container, {}, call);
        return resourceResult(result, readUri);
      }) as never,
    );
  }

  for (const primitive of plan.resourceTemplates) {
    const template = primitive.metadata.uriTemplate ?? primitive.name;
    sdk.registerResource(
      primitive.name,
      new ResourceTemplate(template, { list: undefined }),
      {
        ...(primitive.metadata.title === undefined ? {} : { title: primitive.metadata.title }),
        ...(primitive.metadata.description === undefined
          ? {}
          : { description: primitive.metadata.description }),
        ...(primitive.metadata.mimeType === undefined
          ? {}
          : { mimeType: primitive.metadata.mimeType }),
      },
      (async (readUri: URL, variables: Record<string, unknown>, sdkContext: ServerContext) => {
        const call = callOf(
          "resourceTemplate",
          primitive.name,
          requestContext,
          sdkContext,
          readUri.href,
        );
        const result = await invokeMcpPrimitive(primitive, container, variables, call);
        return resourceResult(result, readUri);
      }) as never,
    );
  }

  for (const primitive of plan.prompts) {
    sdk.registerPrompt(
      primitive.name,
      {
        ...(primitive.metadata.title === undefined ? {} : { title: primitive.metadata.title }),
        ...(primitive.metadata.description === undefined
          ? {}
          : { description: primitive.metadata.description }),
        argsSchema: (primitive.metadata.argsSchema ?? passthroughSchema) as never,
        ...(primitive.metadata.icons === undefined
          ? {}
          : { icons: primitive.metadata.icons as never }),
      },
      (async (input: unknown, sdkContext: ServerContext) => {
        const call = callOf("prompt", primitive.name, requestContext, sdkContext);
        const result = await invokeMcpPrimitive(primitive, container, input, call);
        return promptResult(result);
      }) as never,
    );
  }

  return server;
}

function callOf(
  kind: McpContext["kind"],
  name: string,
  requestContext: McpRequestContext,
  sdkContext: ServerContext,
  uri?: string,
): McpContext {
  const signal = (sdkContext as { readonly signal?: AbortSignal } | undefined)?.signal;

  return {
    kind,
    name,
    ...(uri === undefined ? {} : { uri }),
    transport: requestContext.requestInfo === undefined ? "stdio" : "http",
    ...(requestContext.authInfo === undefined ? {} : { authInfo: requestContext.authInfo }),
    ...(requestContext.requestInfo === undefined
      ? {}
      : { requestInfo: requestContext.requestInfo }),
    ...(platformContext.getStore() === undefined ? {} : { request: platformContext.getStore() }),
    ...(signal === undefined ? {} : { signal }),
    ...(sdkContext === undefined ? {} : { server: sdkContext }),
  };
}

function toolResult(value: unknown, hasOutputSchema: boolean): unknown {
  if (value === undefined) {
    return {};
  }
  if (isCallToolResult(value)) {
    return value;
  }
  if (hasOutputSchema && typeof value === "object" && value !== null && !Array.isArray(value)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      structuredContent: value,
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  };
}

function resourceResult(value: unknown, uri: URL): unknown {
  if (typeof value === "string") {
    return { contents: [{ uri: uri.href, text: value }] };
  }
  if (typeof value === "object" && value !== null && "contents" in value) {
    return value;
  }
  return { contents: [{ uri: uri.href, text: JSON.stringify(value) }] };
}

function promptResult(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "messages" in value) {
    return value;
  }
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: String(value) },
      },
    ],
  };
}

function messageOf(error: unknown): string {
  // Authored failures (an AponiaError or an HttpError) carry a safe message;
  // any other throw may carry internals, so the caller sees a generic line.
  if (error instanceof AponiaError) {
    return error.message;
  }
  if (
    error instanceof Error &&
    typeof (error as { toResponse?: unknown }).toResponse === "function"
  ) {
    return error.message;
  }
  return "Internal server error";
}

function refuseRequest(
  request: Request,
  options: ResolvedMcpOptions,
  parsedBody: unknown,
): Response | undefined {
  const origin = request.headers.get("origin");

  if (origin !== null && options.allowedOrigins !== false) {
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return new Response(null, { status: 403 });
    }
    if (!options.allowedOrigins.includes(hostname)) {
      return new Response(null, { status: 403 });
    }
  }

  if (options.allowedHosts !== undefined) {
    const hostname = new URL(request.url).hostname;
    if (!options.allowedHosts.includes(hostname)) {
      return new Response(null, { status: 403 });
    }
  }

  const declared = request.headers.get("content-length");
  const parsedSize =
    parsedBody === undefined ? 0 : new TextEncoder().encode(JSON.stringify(parsedBody)).length;
  if (
    (declared !== null && Number(declared) > options.maxRequestBodySize) ||
    parsedSize > options.maxRequestBodySize
  ) {
    return new Response(null, { status: 413 });
  }

  return undefined;
}
