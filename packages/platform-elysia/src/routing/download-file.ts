import type { RouteResponseSettings } from "@aponiajs/common";
import { file, type ElysiaFile } from "elysia";
import type { DownloadFileOptions } from "./download-file.types.ts";

/**
 * RFC 8187 §3.2.1's `attr-char`, less `ALPHA` and `DIGIT`, which the predicate
 * below reads by code range. `*`, `'`, and `%` are deliberately absent: they
 * carry meaning inside an extended value.
 */
const extendedValueAttributeCharacters = "!#$&+.^_`|~-";

/** The characters a filename may not carry, and what to call each one. */
const refusedFilenameCharacters = new Map([
  ["/", "a path separator"],
  ["\\", "a path separator"],
  ["\n", "a line feed"],
  ["\r", "a carriage return"],
  ["\u0000", "a NUL"],
]);

const utf8 = new TextEncoder();

function assertNameable(filename: string): void {
  for (const character of filename) {
    const refusal = refusedFilenameCharacters.get(character);
    if (refusal !== undefined) {
      throw new TypeError(
        `downloadFile refuses a filename carrying ${refusal}: the header value names a download, so it may not locate one and may not carry a line break.`,
      );
    }
  }
}

/**
 * The quoted ASCII fallback every client can read. A non-ASCII code unit is
 * replaced rather than transliterated — choosing a Latin spelling for a name is
 * the application's business, and the extended parameter below carries the real
 * name for everything that reads it.
 */
function asciiFallback(filename: string): string {
  let fallback = "";
  for (let index = 0; index < filename.length; index += 1) {
    const character = filename.charAt(index);
    if (character === '"') {
      fallback += '\\"';
    } else if (character.charCodeAt(0) > 0x7f) {
      fallback += "_";
    } else {
      fallback += character;
    }
  }
  return fallback;
}

function isAttributeCharacter(byte: number): boolean {
  const isDigit = byte >= 0x30 && byte <= 0x39;
  const isUpper = byte >= 0x41 && byte <= 0x5a;
  const isLower = byte >= 0x61 && byte <= 0x7a;
  return (
    isDigit ||
    isUpper ||
    isLower ||
    extendedValueAttributeCharacters.includes(String.fromCharCode(byte))
  );
}

/** The name as an RFC 8187 ext-value: the literal `UTF-8''`, then its bytes. */
function extendedValue(filename: string): string {
  let encoded = "";
  for (const byte of utf8.encode(filename)) {
    encoded += isAttributeCharacter(byte)
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `UTF-8''${encoded}`;
}

/**
 * RFC 6266 recommends sending both parameters for every name: the extended one
 * carries the real name, the quoted one is what an older client saves. One
 * construction for every name, rather than a branch for ASCII.
 */
function contentDisposition(disposition: "attachment" | "inline", filename: string): string {
  assertNameable(filename);
  return `${disposition}; filename="${asciiFallback(filename)}"; filename*=${extendedValue(filename)}`;
}

/**
 * Names a download and returns the file the platform streams.
 *
 * A handler already streams a file it returns — with a detected content type,
 * `accept-ranges`, and range support — but it cannot name one. This writes the
 * single header that names it into the settings the handler was handed, and
 * returns `file(path)` unchanged, so the response stays Elysia's.
 *
 * @param settings - the `@Set()` / `@Res()` object the compiled invoker passes.
 * @param path - the file to stream, as `Bun.file` and Elysia's `file` read it.
 * @param filename - the name the client saves or renders, encoded per RFC 8187.
 * @param options - `attachment` (the default) or `inline`.
 * @throws TypeError when `filename` carries a path separator, a line break, or a NUL.
 */
export function downloadFile(
  settings: RouteResponseSettings,
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
