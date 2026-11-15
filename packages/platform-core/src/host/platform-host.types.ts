import type { HostRequestInfo } from "../kernel/kernel.types.ts";

/** What a host must state for the kernel to serve requests through it. */
export interface PlatformHost<TApplication, TNative = unknown> {
  /** The runtime's name, for logs and diagnostics. */
  readonly name: string;
  /** Creates the native application the kernel is mounted on. */
  createApplication(name: string): TApplication;
  /**
   * Mounts the dispatcher on the native application.
   *
   * The dispatcher answers when the kernel matched a route and answers
   * `undefined` when it did not, so the host may continue its own chain.
   */
  mount(application: TApplication, dispatch: HostDispatcher<TNative>): void;
  /** Answers a request through the native application, when the host can. */
  fetch?(application: TApplication, request: Request): Response | Promise<Response>;
  /** Starts a listener, when the runtime can. */
  listen?(
    application: TApplication,
    port: number,
  ): Promise<{ readonly url: string; close(force?: boolean): Promise<void> }>;
  /** Releases what the native application holds. */
  close?(application: TApplication): Promise<void>;
}

/** A request handed to the kernel, with what the host knows about it. */
export type HostDispatcher<TNative = unknown> = (
  request: Request,
  info: HostRequestInfo<TNative>,
) => Promise<Response | undefined>;
