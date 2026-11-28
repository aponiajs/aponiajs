/**
 * The key this platform caches its compiled graph under.
 *
 * The key is platform-scoped: an Elysia descriptor lowers controllers onto
 * Elysia's kind, and a cache slot shared with another platform would make that
 * platform's boot read a graph it cannot mount. One class booted on two
 * platforms in one process keeps one graph per platform.
 */
export const ELYSIA_DESCRIPTOR_CACHE_SYMBOL: symbol = Symbol.for(
  "aponia.compiled.descriptors.elysia",
);

/** The key name `ELYSIA_DESCRIPTOR_CACHE_SYMBOL` was created from. */
export const ELYSIA_DESCRIPTOR_CACHE_KEY = "aponia.compiled.descriptors.elysia";
