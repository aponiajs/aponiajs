import { AponiaError } from "@aponiajs/common";
import type {
  ClassToken,
  ExecutionContext,
  HttpArgumentsHost,
  RouteContext,
  RpcArgumentsHost,
  WsArgumentsHost,
} from "@aponiajs/common";
import type { McpContext } from "../interfaces/mcp-context.interface.ts";

const mcpRoute = Object.freeze({ method: "POST" as const, path: "/mcp" });

/**
 * The execution context a guard, interceptor, pipe, or filter receives for an
 * MCP call.
 *
 * `getType()` answers `"mcp"`, so an enhancer written for HTTP routes can
 * branch before reading a request that is not there.
 */
export class McpExecutionContext implements ExecutionContext {
  readonly #call: McpContext;
  readonly #classToken: ClassToken<unknown>;
  readonly #handler: (...arguments_: never[]) => unknown;
  readonly #input: unknown;

  /** @internal */
  constructor(
    classToken: ClassToken<unknown>,
    handler: (...arguments_: never[]) => unknown,
    input: unknown,
    call: McpContext,
  ) {
    this.#classToken = classToken;
    this.#handler = handler;
    this.#input = input;
    this.#call = call;
  }

  /**
   * Reads an MCP execution context an enhancer was handed.
   *
   * @param context - The execution context.
   * @returns It, typed as the MCP context.
   */
  static create(context: ExecutionContext): McpExecutionContext {
    return context as McpExecutionContext;
  }

  /** The arguments the SDK validated for this call. */
  getInput<T = unknown>(): T {
    return this.#input as T;
  }

  /** Which primitive is running. */
  getKind(): McpContext["kind"] {
    return this.#call.kind;
  }

  /** The tool or prompt name, or the resource URI. */
  getName(): string {
    return this.#call.name;
  }

  /** The MCP call context. */
  getMcpContext(): McpContext {
    return this.#call;
  }

  /** The platform request context, when there is one. */
  getRequest<T = unknown>(): T {
    return this.#call.request as T;
  }

  getType(): "mcp" {
    return "mcp";
  }

  getClass<T = unknown>(): ClassToken<T> {
    return this.#classToken as ClassToken<T>;
  }

  getHandler(): (...arguments_: never[]) => unknown {
    return this.#handler;
  }

  getRoute(): Readonly<{ readonly method: "POST"; readonly path: string }> {
    return mcpRoute;
  }

  getContext<T = RouteContext>(): T {
    return (this.#call.request ?? { request: this.#call.requestInfo }) as T;
  }

  switchToHttp(): HttpArgumentsHost {
    return {
      getRequest: () => this.getContext<RouteContext>(),
    };
  }

  switchToRpc(): RpcArgumentsHost {
    return {
      getData: <T = unknown>() => this.#input as T,
      getContext: () => this.#call as never,
    };
  }

  switchToWs(): WsArgumentsHost {
    throw new AponiaError("UNSUPPORTED_ARGUMENT_HOST", "An MCP call has no WebSocket host.");
  }
}
