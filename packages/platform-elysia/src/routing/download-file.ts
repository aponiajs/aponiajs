import type { ResponseSettingsState } from "@aponiajs/common";
import { contentDisposition, type DownloadFileOptions } from "@aponiajs/common";
import { file, type ElysiaFile } from "elysia";

/**
 * Names a download and returns the file the platform streams.
 *
 * A handler already streams a file it returns — with a detected content type,
 * `accept-ranges`, and range support — but it cannot name one. This writes the
 * single header that names it into the settings the handler was handed, and
 * returns `file(path)` unchanged, so the response stays Elysia's.
 *
 * @param settings - the `@ResponseSettings()` object the compiled invoker passes.
 * @param path - the file to stream, as `Bun.file` and Elysia's `file` read it.
 * @param filename - the name the client saves or renders, encoded per RFC 8187.
 * @param options - `attachment` (the default) or `inline`.
 * @returns The file the platform streams, with the disposition header set.
 * @throws TypeError when `filename` carries a path separator, a line break, or a NUL.
 *
 * @example
 * ```ts
 * download(@ResponseSettings() settings: ResponseSettingsState) {
 *   return downloadFile(settings, "./report.pdf", "report.pdf");
 * }
 * ```
 */
export function downloadFile(
  settings: ResponseSettingsState,
  path: string,
  filename: string,
  options?: DownloadFileOptions,
): ElysiaFile {
  settings.headers["content-disposition"] = contentDisposition(
    options?.disposition ?? "attachment",
    filename,
  );
  return file(path);
}
