import type { LoggerService } from "@aponiajs/common";
import type { StaticDispatchTable } from "@aponiajs/core";
import type { AnyElysia } from "elysia";

/**
 * Shared result consumed by the managed wrapper and native application
 * entrypoints.
 *
 * @internal
 */
export interface ApplicationBootstrapResult {
  readonly nativeApplication: AnyElysia;
  readonly logger: LoggerService | undefined;
  /** Ends one request's lifetime; idempotent at the response boundary. */
  readonly releaseRequest?: (request: Request) => void;
  /** O(1) static route fast-dispatch table compiled at boot when eligible. */
  readonly staticDispatch?: StaticDispatchTable;
}
