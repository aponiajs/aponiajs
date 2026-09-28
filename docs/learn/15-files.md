# 15 · Files

**Use when:** a route receives an uploaded file, or answers with one.

An upload is a body. Elysia parses the multipart request, so the `body` slot is where a
file is declared and `@Body()` is how it arrives:

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

@Controller("files")
export class FilesController {
  @Post({ body: t.Object({ file: t.File() }) })
  upload(@Body("file") file: File) {
    return { name: file.name, size: file.size };
  }
}
```

```ts
await fetch("http://localhost:3080/files", { method: "POST", body: form });
```

`form` is a `FormData` holding the file, and the request sets no `content-type` header:
the engine writes the boundary. `t.File()` alone as the body schema refuses the
upload; name it inside `t.Object({ file: t.File() })`, or reach for `t.Files()` when a
request may carry several.

The handler receives the platform's own `File`. There is no Aponia file type to learn,
and `@Body("file")` already selects one part without a dedicated decorator.

A download is named rather than rebuilt. `downloadFile` writes the header the response
cannot name itself with — encoded, so a name outside ASCII arrives intact — and returns
the file the platform streams:

```ts
import { Get, Set, type RouteResponseSettings } from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Get("download")
download(@Set() set: RouteResponseSettings) {
  return downloadFile(set, "/srv/reports/2026.csv", "2026.csv");
}
```

Next: nothing — this is the last chapter. ·
Deep dive: [files](../files.md)
