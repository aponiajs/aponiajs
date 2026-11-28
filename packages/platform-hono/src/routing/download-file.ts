import type { ResponseSettingsState } from "@aponiajs/common";
import { contentDisposition, type DownloadFileOptions } from "@aponiajs/common";

/**
 * Names a download and returns the response the platform streams.
 *
 * The handler sets the disposition through `@ResponseSettings()` and returns
 * this response; `Bun.file` supplies the content type, and the runtime handles
 * the body. Range support stays the runtime's, as it is for any file response.
 *
 * @param settings - the `@ResponseSettings()` object the kernel passes.
 * @param path - the file to stream, as `Bun.file` reads it.
 * @param filename - the name the client saves or renders, encoded per RFC 8187.
 * @param options - `attachment` (the default) or `inline`.
 * @returns The response the runtime streams.
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
): Response {
  settings.headers["content-disposition"] = contentDisposition(
    options?.disposition ?? "attachment",
    filename,
  );
  return new Response(Bun.file(path));
}
