import type { Token } from "@aponiajs/common";

/** The shape a booted application must have for a test to drive it. */
export interface TestableApplication {
  /** Answers one request through the application's own kernel. */
  handle(request: Request): Response | Promise<Response>;
  /** Resolves a token the graph provides. */
  get<T>(token: Token<T>): T;
  /** Runs the application's shutdown plan. */
  close(): Promise<void>;
}
