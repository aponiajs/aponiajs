import {
  Module,
  createToken,
  dynamicModule,
  moduleOptionsProviders,
  provideValue,
  type DynamicModule,
  type ModuleAsyncOptions,
  type ModuleImport,
  type Provider,
} from "@aponiajs/common";
import { provideHttpPolicyAsync, requirePlatformCapabilities } from "@aponiajs/common";
import { buildCompressionPolicy, resolveCompressionOptions } from "../policy/compression.policy.ts";
import type {
  CompressionModuleOptions,
  ResolvedCompressionOptions,
} from "../interfaces/compression.interface.ts";

const defaultKey = "compression";

const COMPRESSION_RESOLVED = createToken<ResolvedCompressionOptions>(
  "aponia.plugin.compression.resolved",
);

/** Contributes the encoding-aware compression policy. */
@Module({})
export class CompressionModule {
  /**
   * Builds a compression registration.
   *
   * @param options - Threshold, encodings, and module key.
   * @returns The module registration an application imports.
   * @throws An `AponiaError` with `INVALID_COMPRESSION_OPTIONS` when an option is invalid.
   */
  static forRoot(options: CompressionModuleOptions = {}): DynamicModule {
    return registration(
      [provideValue(COMPRESSION_RESOLVED, resolveCompressionOptions(options))],
      options.key ?? defaultKey,
    );
  }

  /**
   * Builds a compression registration whose options a factory resolves.
   *
   * @param options - The imports, injected tokens, factory, key, and extra providers.
   * @returns The module registration an application imports.
   */
  static forRootAsync(
    options: ModuleAsyncOptions<CompressionModuleOptions> & {
      readonly key?: string;
    },
  ): DynamicModule {
    return registration(
      moduleOptionsProviders(COMPRESSION_RESOLVED, options, (resolved) =>
        resolveCompressionOptions(resolved),
      ),
      options.key ?? defaultKey,
      options.imports,
      options.extraProviders,
    );
  }

  /**
   * Builds a compression registration.
   *
   * @deprecated Use {@link CompressionModule.forRoot}; retained for the beta line.
   */
  static register(options: CompressionModuleOptions = {}): DynamicModule {
    return CompressionModule.forRoot(options);
  }
}

function registration(
  resolvedProviders: readonly Provider[],
  key: string,
  imports: readonly ModuleImport[] = [],
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return dynamicModule({
    module: CompressionModule,
    id: `CompressionModule[${key}]`,
    instanceId: Symbol.for(`aponia.compression:${key}`),
    imports,
    providers: [
      ...resolvedProviders,
      provideHttpPolicyAsync([COMPRESSION_RESOLVED], (resolved) =>
        buildCompressionPolicy(resolved),
      ),
      requirePlatformCapabilities("compression", ["http"]),
      ...extraProviders,
    ],
    exports: [],
  });
}
