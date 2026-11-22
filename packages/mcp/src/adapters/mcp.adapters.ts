import { AponiaError } from "@aponiajs/common";
import { getApplicationContainer, type PlatformModuleAdapter } from "@aponiajs/platform-core";
import { createToken } from "@aponiajs/common";
import type { ResolvedMcpOptions } from "../module/mcp-module.types.ts";
import { attachMcpRuntime, createMcpRuntime } from "../transport/mcp-runtime.ts";

/** The adapter tokens the module declares for each platform. @internal */
export const MCP_ELYSIA_ADAPTER = createToken<PlatformModuleAdapter>("aponia.mcp.adapter.elysia");
/** @internal */
export const MCP_HONO_ADAPTER = createToken<PlatformModuleAdapter>("aponia.mcp.adapter.hono");
/** @internal */
export const MCP_H3_ADAPTER = createToken<PlatformModuleAdapter>("aponia.mcp.adapter.h3");

/** Builds the Elysia mount. @internal */
export function elysiaAdapter(options: ResolvedMcpOptions): PlatformModuleAdapter {
  return (application) => mount(application, options, "elysia");
}

/** Builds the Hono mount. @internal */
export function honoAdapter(options: ResolvedMcpOptions): PlatformModuleAdapter {
  return (application) => mount(application, options, "hono");
}

/** Builds the H3 mount. @internal */
export function h3Adapter(options: ResolvedMcpOptions): PlatformModuleAdapter {
  return (application) => mount(application, options, "h3");
}

function mount(
  application: unknown,
  options: ResolvedMcpOptions,
  platform: "elysia" | "hono" | "h3",
): void {
  const container = getApplicationContainer(application);
  if (container === undefined) {
    throw new AponiaError(
      "INVALID_MCP_OPTIONS",
      "The MCP endpoint was mounted on an application no Aponia boot produced.",
    );
  }

  const runtime = createMcpRuntime(container as never, options);
  attachMcpRuntime(application as object, runtime);

  if (options.path === false) {
    return;
  }

  switch (platform) {
    case "elysia": {
      const app = application as {
        all(
          path: string,
          handler: (context: { request: Request; body: unknown }) => Promise<Response>,
        ): unknown;
      };
      app.all(options.path, (context) => runtime.http(context.request, context, context.body));
      return;
    }
    case "hono": {
      const app = application as {
        all(
          path: string,
          handler: (context: { req: { raw: Request } }) => Promise<Response>,
        ): unknown;
      };
      app.all(options.path, (context) => runtime.http(context.req.raw, context));
      return;
    }
    case "h3": {
      const app = application as {
        all(path: string, handler: (event: { req: Request }) => Promise<Response>): unknown;
      };
      app.all(options.path, (event) => runtime.http(event.req, event));
      return;
    }
  }
}
