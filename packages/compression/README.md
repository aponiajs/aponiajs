# @aponiajs/compression

Brotli and gzip response compression for AponiaJS, with a size threshold and
safe skips.

```bash
bun add @aponiajs/compression@alpha
```

## Use it

```ts
import { Module } from "@aponiajs/common";
import { CompressionModule } from "@aponiajs/compression";

@Module({
  imports: [CompressionModule.register()],
})
export class AppModule {}
```

The plugin negotiates `Accept-Encoding`, preferring Brotli when both encodings
are accepted, and leaves responses under the threshold untouched.

## Options

| Option           | Default          | Meaning                                 |
| ---------------- | ---------------- | --------------------------------------- |
| `thresholdBytes` | `1024`           | Minimum body size before compression.   |
| `encodings`      | `["br", "gzip"]` | Offered encodings, in preference order. |
| `key`            | `compression`    | Plugin module identity.                 |

## Behavior

- Only compressible types are compressed: `text/*`, JSON, JavaScript, XML, and
  SVG.
- `HEAD`, `204`, `206`, and `304` responses are skipped.
- A response that already carries `content-encoding` is skipped.
- `Vary: Accept-Encoding` is appended, preserving existing values.
- A `Response` object keeps its status and headers; a string or object response
  leaves through the same status.
- Brotli and gzip are asynchronous, so compression does not block the event
  loop while it runs.

This package compresses responses; it does not decompress requests, cache
compressed bodies, or negotiate content beyond `Accept-Encoding`.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Published packages](../../docs/packages.md)
- [AponiaJS architecture](../../docs/architecture-and-style.md)
- [npm](https://www.npmjs.com/package/@aponiajs/compression)
