type AponiaContainer = {
  readonly graph: {
    readonly root: import("../interfaces/module.interface.ts").ModuleDefinition;
    readonly modules: readonly import("../interfaces/module.interface.ts").ModuleDefinition[];
  };
  get<T>(token: import("../interfaces/token.interface.ts").Token<T>): T;
  resolveModuleProvider<T>(
    moduleDefinition: import("../interfaces/module.interface.ts").ModuleDefinition,
    token: import("../interfaces/token.interface.ts").Token<T>,
  ): T;
};
import { AponiaError } from "../exceptions/aponia-error.ts";
import { createToken } from "../tokens/token.ts";
import { provideValue } from "../providers/provider.ts";
import { type ModuleDefinition } from "../interfaces/module.interface.ts";
import { type Provider } from "../interfaces/provider.interface.ts";
import type {
  PlatformCapability,
  PlatformCapabilities,
  PlatformCapabilityRequirement,
} from "../interfaces/platform-capabilities.interface.ts";

/** Every capability this release defines, in declaration order. */
export const platformCapabilities: readonly PlatformCapability[] = Object.freeze([
  "http",
  "websockets",
  "streaming",
  "multipart",
  "backgroundWork",
]);

export type {
  PlatformCapabilities,
  PlatformCapability,
  PlatformCapabilityRequirement,
} from "../interfaces/platform-capabilities.interface.ts";

/**
 * The capabilities the booted platform states.
 *
 * The provider every boot registers so a package reads what the platform has
 * rather than which runtime it is.
 */
export const PLATFORM_CAPABILITIES = createToken<PlatformCapabilities>(
  "aponia.platform.capabilities",
);

/**
 * A package's capability requirement.
 * @internal
 */
export const PLATFORM_CAPABILITY_REQUIREMENT = createToken<PlatformCapabilityRequirement>(
  "aponia.platform.capability-requirement",
);

/**
 * The capabilities the boot refuses a registration without.
 *
 * `backgroundWork` stays out: a scheduler or a queue registration is valid
 * anywhere, and a platform without it answers a documented deployment note
 * rather than a boot failure.
 */
const requestPathCapabilities: ReadonlySet<PlatformCapability> = new Set([
  "http",
  "websockets",
  "streaming",
  "multipart",
]);

/**
 * Registers the capabilities the running platform states.
 *
 * @param capabilities - The platform name and the capabilities it genuinely has.
 * @returns A frozen value provider the boot registers before the graph runs.
 * @throws A `TypeError` when a capability is not one this release defines.
 */
export function providePlatformCapabilities(capabilities: PlatformCapabilities): Provider {
  const unknown = capabilities.capabilities.filter(
    (capability) => !platformCapabilities.includes(capability),
  );
  if (unknown.length > 0) {
    throw new TypeError(`Unknown platform capability: ${unknown.join(", ")}.`);
  }
  return provideValue(
    PLATFORM_CAPABILITIES,
    Object.freeze({
      platform: capabilities.platform,
      capabilities: Object.freeze([...new Set(capabilities.capabilities)]),
    }),
  );
}

/**
 * Declares the capabilities one package's registration needs.
 *
 * @param key - The package identity a refusal names.
 * @param capabilities - The capabilities the registration serves.
 * @returns A frozen value provider the package's module registers.
 * @throws A `TypeError` when the key is empty or a capability is unknown.
 */
export function requirePlatformCapabilities(
  key: string,
  capabilities: readonly PlatformCapability[],
): Provider {
  if (key.trim().length === 0) {
    throw new TypeError("A capability requirement needs a non-empty package key.");
  }
  const unknown = capabilities.filter((capability) => !platformCapabilities.includes(capability));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown platform capability: ${unknown.join(", ")}.`);
  }
  return provideValue(
    PLATFORM_CAPABILITY_REQUIREMENT,
    Object.freeze({ key, capabilities: Object.freeze([...new Set(capabilities)]) }),
  );
}

/**
 * Reads the capabilities the boot provided.
 *
 * @param container - The container the boot built.
 * @returns The capabilities, or `undefined` for a boot that stated none.
 */
export function readPlatformCapabilities(
  container: AponiaContainer,
): PlatformCapabilities | undefined {
  try {
    return container.get(PLATFORM_CAPABILITIES) as PlatformCapabilities;
  } catch {
    return undefined;
  }
}

/**
 * Refuses every declared requirement the platform cannot serve.
 *
 * The check is total and runs before anything mounts, so an unsupported
 * capability never leaves an application half-mounted. Only request-path
 * capabilities refuse; `backgroundWork` is a deployment note.
 *
 * @param container - The container the boot built.
 * @throws An `AponiaError` with `UNSUPPORTED_PLATFORM_FEATURE`, naming the
 * package, the missing capability, and the platform.
 */
export function assertPlatformCapabilities(container: AponiaContainer): void {
  const declared = readPlatformCapabilities(container);
  if (declared === undefined) {
    return;
  }

  for (const module of container.graph.modules) {
    const requirement = readRequirement(container, module);
    if (requirement === undefined) {
      continue;
    }
    for (const capability of requirement.capabilities) {
      if (!requestPathCapabilities.has(capability)) {
        continue;
      }
      if (declared.capabilities.includes(capability)) {
        continue;
      }
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The package "${requirement.key}" requires the "${capability}" capability, which the ${declared.platform} platform does not have.`,
        {
          module: requirement.key,
          platform: declared.platform,
          capability,
          capabilities: declared.capabilities,
        },
      );
    }
  }
}

function readRequirement(
  container: AponiaContainer,
  module: ModuleDefinition,
): PlatformCapabilityRequirement | undefined {
  if (!module.providers.some((provider) => provider.provide === PLATFORM_CAPABILITY_REQUIREMENT)) {
    return undefined;
  }
  return container.resolveModuleProvider(
    module,
    PLATFORM_CAPABILITY_REQUIREMENT,
  ) as PlatformCapabilityRequirement;
}
