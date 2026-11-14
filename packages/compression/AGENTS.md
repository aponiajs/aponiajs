# @aponiajs/compression — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The compression module, the encoding policy, and the Elysia plugin. It is a
leaf: nothing in the framework depends on it.

| Domain    | Owns                                                           |
| --------- | -------------------------------------------------------------- |
| `module/` | `CompressionModule.register` and options                       |
| `policy/` | encoding negotiation, compressibility, response transformation |

`src/index.ts` is the only public barrel.

## Invariants

- **Only compressible types are compressed.** Do not gzip images, video, zip,
  or already-compressed payloads.
- **Respect the threshold.** A body smaller than `thresholdBytes` stays as-is.
- **Skip bodyless statuses and existing encodings.** `HEAD`, `204`, `206`, `304`,
  and a response with `content-encoding` are not compressed.
- **Append `Vary: Accept-Encoding` without dropping existing values.** A shared
  cache depends on that header being complete.
- **Compression is asynchronous.** Do not replace the zlib calls with blocking
  `*Sync` variants.
- **Configuration failures are `AponiaError` with
  `INVALID_COMPRESSION_OPTIONS`.** Keep the code and the frozen issue list.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create`, exercises gzip and
Brotli, decompresses the bodies, and checks the threshold and skip paths.
