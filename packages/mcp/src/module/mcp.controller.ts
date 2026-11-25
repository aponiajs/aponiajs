import { All, Controller, Inject, Req } from "@aponiajs/common";
import type { McpRuntime } from "../transport/mcp-runtime.ts";
import { MCP_RUNTIME } from "../transport/mcp-runtime.ts";

/**
 * Builds the controller one registration mounts its HTTP endpoint on.
 *
 * The class is generated per registration because the endpoint path is a
 * registration option, and a route path is fixed when the class is decorated.
 * The runtime arrives through `@Inject`, so the discovery plan is built once at
 * boot and every request shares it.
 *
 * @internal
 */
export function createMcpController(
  path: string,
): new (runtime: McpRuntime) => { handle(request: Request): Promise<Response> } {
  class McpEndpointController {
    readonly #runtime: McpRuntime;

    constructor(runtime: McpRuntime) {
      this.#runtime = runtime;
    }

    handle(request: Request): Promise<Response> {
      return this.#runtime.http(request);
    }
  }

  Controller()(McpEndpointController);
  (All(path) as unknown as (target: object, key: string) => void)(
    McpEndpointController.prototype,
    "handle",
  );
  Req()(McpEndpointController.prototype, "handle", 0);
  Inject(MCP_RUNTIME)(McpEndpointController, undefined, 0);

  return McpEndpointController as unknown as new (runtime: McpRuntime) => {
    handle(request: Request): Promise<Response>;
  };
}
