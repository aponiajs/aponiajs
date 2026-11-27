# @aponiajs/compression

Brotli and gzip response compression for AponiaJS, with a size threshold and
safe skips.

```bash
bun add @aponiajs/compression@alpha
```

## Use it

### Register the module

```ts
import { Module } from "@aponiajs/common";
import { CompressionModule } from "@aponiajs/compression";

@Module({
  imports: [CompressionModule.forRoot()],
})
export class AppModule {}
```

### Use it in a controller

```ts
import { Controller, Get } from "@aponiajs/common";

@Controller("reports")
export class ReportsController {
  @Get()
  read() {
    return { rows: Array.from({ length: 200 }, (_, index) => ({ id: index })) };
  }
}
```

No service is injected; this package contributes a policy/endpoint. The policy
negotiates `Accept-Encoding`, preferring Brotli when both encodings are
accepted, and leaves responses under the threshold untouched. A compressible
body above `thresholdBytes` answers with `content-encoding` and an appended
`vary: Accept-Encoding`.

### Async registration

`CompressionModule.forRootAsync` accepts a factory, a class, or an existing
provider, and a factory may answer a Promise:

```ts
CompressionModule.forRootAsync({
  useFactory: async () => ({ thresholdBytes: 2_048 }),
});
```

```ts
import { Injectable } from "@aponiajs/common";

@Injectable()
class CompressionSettings {
  create() {
    return { thresholdBytes: 2_048 };
  }
}

CompressionModule.forRootAsync({ useClass: CompressionSettings });
```

```ts
@Module({ providers: [CompressionSettings], exports: [CompressionSettings] })
class CompressionSettingsModule {}

CompressionModule.forRootAsync({
  imports: [CompressionSettingsModule],
  useExisting: CompressionSettings,
});
```

## Options

| Option           | Default          | Meaning                                 |
| ---------------- | ---------------- | --------------------------------------- |
| `thresholdBytes` | `1024`           | Minimum body size before compression.   |
| `encodings`      | `["br", "gzip"]` | Offered encodings, in preference order. |
| `key`            | `compression`    | Module identity.                        |

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

- [Published packages](../../docs/reference/packages.md)
- [AponiaJS architecture](../../docs/build/architecture-and-style.md)
- [npm](https://www.npmjs.com/package/@aponiajs/compression)
