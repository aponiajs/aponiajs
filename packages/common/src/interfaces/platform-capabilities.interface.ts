/**
 * A capability a platform genuinely has.
 *
 * The set is fixed and closed: a package picks from it rather than naming a
 * runtime, so a plugin states what it needs instead of where it runs. A
 * deployment mode is not a capability — the Web Fetch serverless adapter has
 * `http` exactly as a listening server does.
 */
export type PlatformCapability =
  | "http"
  | "websockets"
  | "streaming"
  | "multipart"
  | "backgroundWork";

/**
 * The capabilities the booted platform states.
 *
 * A provider reads this instead of importing a runtime package; the boot
 * registers one per application.
 */
export interface PlatformCapabilities {
  /** The runtime's name, for diagnostics and for a refusal's message. */
  readonly platform: string;
  /** The capabilities this platform genuinely has. */
  readonly capabilities: readonly PlatformCapability[];
}

/**
 * The capabilities one package needs to serve its registration.
 *
 * A package states this once. The boot refuses a missing request-path
 * capability before anything mounts, naming the package, the capability, and
 * the platform. `backgroundWork` is deliberately not a request-path
 * capability: a scheduler or a queue registration stays valid on a platform
 * that has none, and the deployment note is documentation rather than a
 * refusal.
 */
export interface PlatformCapabilityRequirement {
  /** The package identity a refusal names. */
  readonly key: string;
  /** The capabilities the registration needs. */
  readonly capabilities: readonly PlatformCapability[];
}
