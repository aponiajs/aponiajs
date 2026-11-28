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
  PlatformAdapterHost,
  PlatformModuleAdapter,
  PlatformModuleSupport,
  ResolvedPlatformModule,
} from "./platform-module.types.ts";

/** Every platform the framework ships. */
export const ALL_PLATFORMS: readonly string[] = Object.freeze(["elysia", "hono", "h3"]);

/**
 * The private token carrying a module's platform declaration.
 * @internal
 */
export const PLATFORM_MODULE = createToken<PlatformModuleSupport>("aponia.platform.module");

/** The running platform, injectable by any provider or package. */
export const PLATFORM_ADAPTER_HOST = createToken<PlatformAdapterHost>(
  "aponia.platform.adapter-host",
);

/**
 * Declares the platforms a package runs on, and the native mount each needs.
 *
 * This is the package's one declaration: the boot refuses an undeclared
 * platform before anything mounts, and selects `adapters[platform]` when the
 * package stated one. A package that runs everywhere in neutral code states
 * nothing.
 *
 * @param support - The package identity, its platforms, and its per-platform mounts.
 * @returns A frozen value provider the module's `providers` accepts.
 *
 * @example
 * ```ts
 * providers: [
 *   providePlatformModule({
 *     key: "widgets",
 *     platforms: ["elysia"],
 *     adapters: { elysia: (app) => app.use(widgetsPlugin) },
 *   }),
 * ]
 * ```
 */
export function providePlatformModule<TNative = unknown>(
  support: PlatformModuleSupport<TNative>,
): Provider {
  if (support.key.trim().length === 0) {
    throw new TypeError("Platform module key must not be empty.");
  }

  const platforms = Object.freeze([
    ...(support.platforms ??
      (support.adapters === undefined ? ALL_PLATFORMS : Object.keys(support.adapters))),
  ]);
  const adapters =
    support.adapters === undefined ? undefined : Object.freeze({ ...support.adapters });

  return provideValue(
    PLATFORM_MODULE,
    Object.freeze({
      key: support.key,
      platforms,
      ...(adapters === undefined ? {} : { adapters }),
    }) as PlatformModuleSupport,
  );
}

/** A declaration whose platforms are resolved, as every provided one is. */
type ResolvedSupport<TNative> = PlatformModuleSupport<TNative> & {
  readonly platforms: readonly string[];
};

/**
 * Reads the declarations one module graph carries.
 *
 * @param container - The container the boot built.
 * @param platform - The platform the boot serves.
 * @returns The declarations the graph states, in graph order.
 */
export function resolvePlatformModules<TNative = unknown>(
  container: AponiaContainer,
  platform: string,
): readonly ResolvedPlatformModule<TNative>[] {
  const declared: { module: ModuleDefinition; support: ResolvedSupport<TNative> }[] = [];

  for (const module of container.graph.modules) {
    const support = readSupport<TNative>(container, module);
    if (support === undefined) {
      continue;
    }
    if (!support.platforms.includes(platform)) {
      throw new AponiaError(
        "UNSUPPORTED_PLATFORM_FEATURE",
        `The package "${support.key}" does not support the ${platform} platform.`,
        { module: support.key, platform, platforms: support.platforms },
      );
    }
    declared.push({ module, support });
  }

  const resolved: ResolvedPlatformModule<TNative>[] = [];
  for (const { module, support } of declared) {
    const entry = support.adapters?.[platform];
    const adapter =
      entry === undefined
        ? undefined
        : typeof entry === "function"
          ? entry
          : (container.resolveModuleProvider(module, entry) as PlatformModuleAdapter<TNative>);

    resolved.push(
      Object.freeze({
        key: support.key,
        platforms: support.platforms,
        ...(adapter === undefined ? {} : { adapter }),
      }),
    );
  }

  return Object.freeze(resolved);
}

/**
 * Refuses an undeclared platform, then runs each package's native mount.
 *
 * The refusal happens for every declaration before the first mount, so an
 * unsupported platform never leaves an application half-mounted.
 *
 * @param container - The container the boot built.
 * @param application - The native application the host created.
 * @param platform - The platform the boot serves.
 */
export async function applyPlatformModules<TNative = unknown>(
  container: AponiaContainer,
  application: TNative,
  platform: string,
): Promise<void> {
  for (const declaration of resolvePlatformModules<TNative>(container, platform)) {
    await declaration.adapter?.(application);
  }
}

function readSupport<TNative>(
  container: AponiaContainer,
  module: ModuleDefinition,
): ResolvedSupport<TNative> | undefined {
  if (!module.providers.some((provider) => provider.provide === PLATFORM_MODULE)) {
    return undefined;
  }
  return container.resolveModuleProvider(module, PLATFORM_MODULE) as ResolvedSupport<TNative>;
}
