import type { InjectionToken } from "../interfaces/token.interface.ts";

/**
 * Mounts a package's contribution onto the running platform's native
 * application. The package writes it once per platform; the boot calls the one
 * the host names and the application never branches.
 */
export type PlatformModuleAdapter<TNative = unknown> = (
  application: TNative,
) => void | Promise<void>;

/**
 * An adapter stated inline, or a token the declaring module resolves it
 * through — which is how a package builds a native mount from a container
 * value without a second async registration seam.
 */
export type PlatformAdapterEntry<TNative = unknown> =
  | PlatformModuleAdapter<TNative>
  | InjectionToken<PlatformModuleAdapter<TNative>>;

/**
 * The declaration a package adds to its module registration.
 *
 * An omitted `platforms` means every platform the framework ships; when only
 * `adapters` is stated, the declared platforms are the adapter keys.
 */
export interface PlatformModuleSupport<TNative = unknown> {
  /** The package identity a refusal names. */
  readonly key: string;
  /** The platforms the package runs on. */
  readonly platforms?: readonly string[] | undefined;
  /** The per-platform native mounts, keyed by platform name. */
  readonly adapters?: Readonly<Record<string, PlatformAdapterEntry<TNative>>> | undefined;
}

/** A declaration resolved against one platform. */
export interface ResolvedPlatformModule<TNative = unknown> {
  /** The package identity the declaration states. */
  readonly key: string;
  /** The platforms the package declared. */
  readonly platforms: readonly string[];
  /** The mount selected for the running platform, when the package stated one. */
  readonly adapter?: PlatformModuleAdapter<TNative> | undefined;
}

/**
 * The running platform, reachable from the container without importing a
 * runtime — the role Nest's `HttpAdapterHost` plays.
 */
export interface PlatformAdapterHost<TNative = unknown> {
  /** The platform name the boot selected. */
  readonly platform: string;
  /** The native application the host created. */
  readonly nativeApplication: TNative;
}
