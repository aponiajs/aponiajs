import type { OnApplicationShutdown } from "@aponiajs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/** One stateful session: a server and the transport it is connected to. */
export interface McpSession {
  readonly server: McpServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
}

/**
 * The stateful sessions one boot owns.
 *
 * A provider rather than a module-level map, because a registration builds one
 * `DynamicModule` and a process may build more than one application from it:
 * closing one application must not close another's sessions.
 *
 * `onApplicationShutdown` is how `application.close()` reaches the transports.
 * The map is read and cleared before anything is awaited, so a second close
 * finds nothing to close twice.
 *
 * @internal
 */
export class McpSessionRegistry implements OnApplicationShutdown {
  readonly #sessions = new Map<string, McpSession>();

  /** The number of sessions this boot currently holds. */
  get size(): number {
    return this.#sessions.size;
  }

  /** Returns the session registered under an id, or `undefined`. */
  get(id: string): McpSession | undefined {
    return this.#sessions.get(id);
  }

  /** Registers one session. */
  set(id: string, session: McpSession): void {
    this.#sessions.set(id, session);
  }

  /** Forgets one session, which is what a DELETE request does. */
  delete(id: string): void {
    this.#sessions.delete(id);
  }

  /**
   * Closes every session this boot holds.
   *
   * `McpServer.close()` closes the transport it is connected to, so closing the
   * server is the whole cleanup. Failures are settled rather than raised:
   * shutdown closes every session it can.
   */
  async closeAll(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.server.close()));
  }

  /** Ends every session when the application closes. */
  async onApplicationShutdown(): Promise<void> {
    await this.closeAll();
  }
}
