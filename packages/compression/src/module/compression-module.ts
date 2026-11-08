import { Module, type DynamicModule } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { buildCompressionPlugin, resolveCompressionOptions } from "../policy/compression-policy.ts";
import type { CompressionModuleOptions } from "./compression.types.ts";

/** Mounts the encoding-aware compression plugin. */
@Module({})
export class CompressionModule {
  /**
   * Builds a compression registration.
   *
   * @param options - Threshold, encodings, and module key.
   * @returns The plugin registration an application imports.
   * @throws An `AponiaError` with `INVALID_COMPRESSION_OPTIONS` when an option is invalid.
   */
  static register(options: CompressionModuleOptions = {}): DynamicModule {
    const resolved = resolveCompressionOptions(options);
    return PluginModule.register(buildCompressionPlugin(resolved), {
      key: options.key ?? "compression",
    });
  }
}
