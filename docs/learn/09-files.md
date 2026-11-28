# 09 · Files

**Use when:** a route receives an uploaded file or answers with one.

An upload is a body. Elysia parses the multipart request, so the `body` slot declares the file and `@Body()` receives it:

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

`form` is a `FormData` holding the file. Do not set `content-type`; the engine writes the boundary. A bare `t.File()` as the body schema refuses the upload. Name it inside `t.Object({ file: t.File() })`, or use `t.Files()` for several files.

The handler receives the platform's `File`. `@Body("file")` selects one part without a dedicated decorator.

## Download

`downloadFile` writes an encoded `content-disposition` header and returns the file the platform streams:

```ts
import { Get, ResponseSettings, type ResponseSettingsState } from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Get("download")
download(@ResponseSettings() set: ResponseSettingsState) {
  return downloadFile(set, "/srv/reports/2026.csv", "2026.csv");
}
```

Next: [10 · Lifecycle](./10-lifecycle.md) · Deep dive: [files](../build/files.md)
