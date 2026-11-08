/**
 * `@aponiajs/compression` — Brotli and gzip response compression.
 *
 * The plugin negotiates `Accept-Encoding`, compresses only compressible bodies
 * above a size threshold, skips already-encoded and bodyless responses, and
 * appends `Vary: Accept-Encoding`.
 */
export { CompressionModule } from "./module/compression-module.ts";
export type { CompressionModuleOptions } from "./module/compression.types.ts";
