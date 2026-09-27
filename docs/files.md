# Files

A file is a body value. Elysia parses a multipart request into a `File`, the `body`
slot validates it, and `@Body()` hands it to the handler exactly as it hands over any
other parsed body. There is no Aponia file type, no file parameter decorator, and no
file schema slot, because none of them would add anything the substrate does not
already do.

## Uploads

| Declaration                            | Result                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `body: t.Object({ file: t.File() })`   | `200`; `@Body()` is `{ file }` and `file instanceof File` is true            |
| `@Body("file")` over that same schema  | `200`; the parameter is the `File` directly                                  |
| `body: t.Object({ files: t.Files() })` | `200`; the body is `{ files: File[] }`                                       |
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
or in the handler, never on `file.type`. Measured on Bun 1.4.2 with Elysia 1.4.30,
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
