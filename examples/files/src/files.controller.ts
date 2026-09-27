import { Body, Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

/**
 * A file is an ordinary body value: the `body` slot carries it, `@Body()` hands
 * it over, and the handler receives the platform's own `File`. Nothing here is
 * Aponia-specific except the decorators around it.
 */
@Controller("files")
export class FilesController {
  @Post("single", { body: t.Object({ file: t.File({ maxSize: "1m" }) }) })
  uploadSingle(@Body() body: { file: File }) {
    return { name: body.file.name, size: body.file.size, type: body.file.type };
  }

  @Post("named", { body: t.Object({ file: t.File() }) })
  uploadNamed(@Body("file") file: File) {
    return { name: file.name, size: file.size, type: file.type };
  }

  @Post("many", { body: t.Object({ files: t.Files({ maxItems: 3 }) }) })
  uploadMany(@Body("files") files: File[]) {
    return { count: files.length, names: files.map((entry) => entry.name) };
  }

  @Post("form", { body: t.Form({ label: t.String(), file: t.File() }) })
  uploadForm(@Body() body: { label: string; file: File }) {
    return { label: body.label, name: body.file.name };
  }

  // The shape a reader tries first, kept here because it is the one that refuses:
  // `t.File()` validates a value that is already a `File`, so as the whole body
  // it rejects the parsed multipart body with `422`.
  @Post("top-level", { body: t.File() })
  uploadTopLevel(@Body() body: File) {
    return { name: body.name };
  }
}
