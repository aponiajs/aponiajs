# Files

A file is a body value. Elysia parses a multipart request into a `File`, the `body`
slot validates it, and `@Body()` hands it to the handler exactly as it hands over any
other parsed body. `@UploadedFile()` and `@UploadedFiles()` are convenience aliases
for `@Body("file")` and `@Body("files")`; they add no separate file type, schema slot,
or transport.

## Uploads

| Declaration                            | Result                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `body: t.Object({ file: t.File() })`   | `200`; `@Body()` is `{ file }` and `file instanceof File` is true            |
| `@Body("file")` over that same schema  | `200`; the parameter is the `File` directly                                  |
| `@UploadedFile()` over that schema     | `200`; the same `File`, bound from the `file` body field                     |
| `body: t.Object({ files: t.Files() })` | `200`; the body is `{ files: File[] }`                                       |
| `@UploadedFiles()` over that schema    | `200`; the same `File[]`, bound from the `files` body field                  |
| `body: t.Form({ file: t.File() })`     | `200`; the body is the parsed form, with the part as a `File`                |
| `body: t.File()`                       | **`422`**, `Expected kind 'File'` — `expected` and `found` are both `"File"` |

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

@Controller("files")
export class FilesController {
  @Post("single", { body: t.Object({ file: t.File({ maxSize: "3m" }) }) })
  upload(@Body() body: { file: File }) {
    return { name: body.file.name, size: body.file.size };
  }

  @Post("many", { body: t.Object({ files: t.Files() }) })
  uploadMany(@Body("files") files: File[]) {
    return { count: files.length };
  }
}
```

### The type is the filename

`file.type` is not the content type the request declared. The multipart parser discards
that header and looks the filename up in a MIME table, so the value is derived from the
name the client chose: a part named `photo.png` arrives as `image/png` even when the
request declared `text/plain`, `notes.txt` arrives as `text/plain;charset=utf-8`, a name
with no extension arrives as `""`, and `.xyz` arrives as `chemical/x-xyz`. The declared
type never reaches the handler.

Treat it as input rather than as a fact about the bytes. A client chooses its own
filename, so a content check belongs on the content — `t.File({ type })` inspects it —
or in the handler, never on `file.type`. Measured on Bun 1.4.2 with Elysia 2.0.0-rc.4,
identically through raw Elysia and through this framework.

### The shape that refuses

`t.File()` validates a value that is already a `File`. As a whole-body schema it is
therefore asked to validate the object Elysia built from the multipart request, and it
answers `422` — even when the request is a valid single-file upload. A single file is
named inside something: an object, `t.Form`, or `t.Files` for one-or-more.

That `422` is Elysia's own validation answer (`type: "validation"`,
`application/json`), not the platform's RFC 9457 Problem Details. The platform's
default mapping declines a status Elysia already decided, so a rejected upload keeps
the response shape Elysia gives it.

### Limits

`minSize` and `maxSize` are declared on the validator and enforced before the handler
runs, with no dependency and no Aponia surface:

```ts
@Post("upload", { body: t.Object({ file: t.File({ minSize: "1k", maxSize: "3m" }) }) })
```

`type` is a content check rather than a content-type check. It inspects the file's
bytes, so a plain-text file whose part says `text/plain` is refused by
`t.File({ type: "text/plain" })` with `has invalid file type`, because no signature
identifies it. Declare `type` for formats that carry one — images, audio, video,
archives — and check anything finer in the handler. Elysia's `extension` option is not
part of this surface: it is absent from the declared options and is not enforced
through `t.File`.

`examples/files` runs every shape above, the refusal included, as an application you can
start with `bun run example:files`.

## Downloads

A handler that returns a `File`, a `Bun.file(...)`, or Elysia's `file(...)` streams it:
the platform detects the content type and the substrate adds `accept-ranges` and range
support. What it cannot do is name it — `content-disposition` is absent — and a name
written by hand into that header fails on the case a non-English application hits
first. A code point above `U+00FF` is outside what a header value may carry, so the
value escapes `application.handle` as a `TypeError` with no response at all.

`downloadFile` writes that one value and returns the file:

```ts
import {
  Controller,
  Get,
  Param,
  ResponseSettings,
  type ResponseSettingsState,
} from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Controller("reports")
export class ReportController {
  @Get(":id")
  read(@Param("id") id: string, @ResponseSettings() set: ResponseSettingsState) {
    return downloadFile(set, `/srv/reports/${id}.csv`, `${id}.csv`);
  }
}
```

On Elysia it constructs no `Response`, opens no stream, and reads no file: the
returned value is what the platform streams, so range requests and content-type
detection stay Elysia's. On Hono and H3 the same helper is exported and returns a
`Response` whose body is `Bun.file(path)`; import it from
`@aponiajs/platform-hono` or `@aponiajs/platform-h3`. The header encoding is the
shared `contentDisposition` in `@aponiajs/common`, so the name is identical
on every platform.
The name follows RFC 6266 with the RFC 8187 extended parameter — `filename*`
carries the real name UTF-8 percent-encoded, and a quoted ASCII fallback carries a
name an older client can save — so both parameters are always present and a pure-ASCII
name is the ordinary case rather than a branch. `{ disposition: "inline" }` renders
instead of saving. A name carrying a line break, a NUL, or a path separator is refused
with a `TypeError`: a value an application hands a helper while it runs is a caller
mistake, which is the runtime half of the convention the batch delivery document
states.

The helper reads no file, so a path that does not exist is not its answer to give. The file
is opened while the response body streams, which is past the route's error path: a caller
over a socket gets the server's own `500` rather than a `404`, and a caller through
`application.handle` meets the failure when it reads the body. A path built from request
input is worth checking before it is handed over.

## Static assets

`AponiaHttpApplicationOptions.staticAssets` serves one or more directories on
every platform. The path rule and the response headers are shared; each platform
opens the file with its own runtime:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  staticAssets: {
    prefix: "/assets",
    root: "./public",
    maxAge: 60, // cache-control: public, max-age=60
  },
});
```

| Field    | Meaning                                                                  |
| -------- | ------------------------------------------------------------------------ |
| `prefix` | The public path the files mount under; `/` serves them at the root.      |
| `root`   | The directory the files are read from.                                   |
| `index`  | The file a directory request answers; defaults to `index.html`.          |
| `maxAge` | The `cache-control` max age in seconds, when the application states one. |

Several directories are one array, checked in declaration order:

```ts
staticAssets: [
  { prefix: "/assets", root: "./public", maxAge: 3600 },
  { prefix: "/downloads", root: "./downloads" },
];
```

A file answers **before** plugins, middleware, guards, interceptors, and filters.
An asset is fetched without the application's credentials, so nothing the
application declares may sit in front of it; a miss continues to the routes, so
an explicit controller path is not shadowed by a missing file. A file that does
exist at a path a controller also claims wins — declare the static prefix away
from the application's routes. The static prefix is independent of the
application's `prefix`.

The shared resolver refuses a request outside the prefix, a segment that escapes
the root (`..`, encoded or not), a backslash, a NUL, and a percent-escape that
does not decode. A refusal is a `404` from the runtime, answered exactly as the
runtime answers any unmatched path.

The response carries the runtime's content type, a `last-modified` header, and
the configured `cache-control`. Range and conditional requests are the runtime's
own: this feature does not add `ETag` or `Range` handling.

A custom host that states no `mountStaticAssets` fails the boot with
`UNSUPPORTED_PLATFORM_FEATURE` rather than starting without the directory.

### Native escape hatches

Two lower-level paths stay available, and they are not equivalent.

| Path                           | Needs                                                  | Inside Elysia's lifecycle | Cost                                                           |
| ------------------------------ | ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------- |
| `@elysia/static` via `plugins` | `bun add @elysia/static` in the application            | Yes                       | A dependency the application owns; the framework gains nothing |
| Bun native directory route     | `configureNative` setting `native.config.serve.routes` | **No**                    | The route leaves Elysia entirely, so no Elysia hook sees it    |

The plugin keeps the request inside Elysia, so Elysia's own lifecycle handles it — but not
the enhancers or the default Problem Details mapping, which are compiled into the routes
the platform mounts, and a plugin's route is not one of them. The native route is Bun's,
and it answers `404` with no content type and no Problem Details for the same reason. It is
also the one that arrives with the hardening a file server needs — canonical-path
rejection, `Last-Modified` and a weak `ETag`, single-range `Range` requests — so choose it
when range support matters more than the framework's own path rule.

```ts
import { resolve } from "node:path";
import type { Elysia } from "elysia";
import type { ElysiaConfigurator } from "@aponiajs/platform-elysia";

// `../public` from a file under `src/`: the directory is resolved from the file,
// not from the working directory, so the route answers wherever the process starts.
export const configureStaticAssets: ElysiaConfigurator<Elysia> = (native) => {
  native.config.serve = {
    ...native.config.serve,
    routes: {
      ...native.config.serve?.routes,
      "/assets/*": { dir: resolve(import.meta.dir, "../public") },
    },
  };
  return native;
};
```

Three details decide whether that works. The route belongs on `config.serve`, not in
the options `listen` takes: the Bun adapter builds the routes it hands to `Bun.serve`
from the application's own routes merged with `config.serve.routes`, so an
`options.routes` is overwritten. The prefix must end in `/*`. And `dir` is read
relative to the process working directory, so resolve it — a relative path works when
the application is started from its own directory and throws `ENOENT` from anywhere
else.
