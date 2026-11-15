import type { LoggerService } from "@aponiajs/common";
import type { HttpKernelOptions } from "../kernel/kernel.types.ts";

/** What an application on a non-Elysia platform is built with. */
export interface AponiaHttpApplicationOptions {
  /** The logger failures are reported through; `false` silences reporting. */
  readonly logger?: LoggerService | false;
  /** A prefix every Aponia route mounts under. */
  readonly prefix?: string;
  /** Application state, handed to every request as `store`. */
  readonly state?: Record<string, unknown>;
  /** The largest request body the kernel reads, in bytes. */
  readonly maxBodyBytes?: number;
  /** The Aponia middleware chain, run before a route's guards. */
  readonly middleware?: HttpKernelOptions["middleware"];
  /** Renders a `@Render()` route's view. */
  readonly renderView?: HttpKernelOptions["renderView"];
  /** Adjusts the native application before anything is mounted on it. */
  readonly configureNative?: (application: never) => unknown;
}
