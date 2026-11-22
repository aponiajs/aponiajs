import { AponiaError } from "@aponiajs/common";
import { normalizeRoutePrefix, stripRoutePrefix } from "./route-prefix.ts";
import type { StaticAssetsOptions } from "./static-assets.types.ts";

/**
 * Resolves one request path to the file a static directory serves.
 *
 * The resolver is runtime-neutral: a host calls it, then opens the returned
 * path with its own file API. A request outside the prefix, an encoded path
 * that cannot be decoded, a segment that escapes the root, a backslash, or a
 * NUL answers `undefined`, so a traversal never reaches the filesystem.
 *
 * @param pathname - The request path, without a query string.
 * @param options - The directory and its public prefix.
 * @returns The file path to serve, or `undefined` when the request is not one
 *   the directory answers.
 *
 * @example
 * ```ts
 * resolveStaticAssetPath("/assets/app.css", { prefix: "/assets", root: "./public" });
 * // "./public/app.css"
 * ```
 */
export function resolveStaticAssetPath(
  pathname: string,
  options: StaticAssetsOptions,
): string | undefined {
  const prefix = normalizeRoutePrefix(options.prefix);
  const publicPath = stripRoutePrefix(pathname, prefix);
  if (publicPath === undefined) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(publicPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\u0000") || decoded.includes("\\")) {
    return undefined;
  }

  const index = options.index ?? "index.html";
  const segments: string[] = [];
  for (const segment of decoded.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }

  const root = options.root.replace(/\/+$/, "");
  const directory = decoded === "" || decoded === "/" || decoded.endsWith("/");
  const relative = segments.join("/");
  const base = relative === "" ? root : `${root}/${relative}`;
  return directory ? `${base}/${index}` : base;
}

/** A file body a host opened, and the facts a response needs from it. */
export interface StaticFileSource {
  /** The body the runtime streams. */
  readonly body: string | Uint8Array | ArrayBuffer | Blob | ReadableStream;
  /** Whether the file exists; a missing file declines the request. */
  readonly exists: boolean | Promise<boolean>;
  /** The file's modification time in milliseconds, when the host states one. */
  readonly lastModified?: number;
}

/** Opens one resolved path with the runtime's own file API. */
export type StaticFileOpener = (path: string) => StaticFileSource;

/**
 * Answers one request from a static directory, or declines it.
 *
 * The resolver owns the path rule and this function owns the response shape, so
 * every platform answers the same headers for the same file; only opening the
 * path is the runtime's.
 *
 * @param pathname - The request path, without a query string.
 * @param options - The directory, prefix, index, and cache policy.
 * @param open - Opens a resolved path with the runtime's file API.
 * @returns The response, or `undefined` when the request names no file.
 */
export async function answerStaticAsset(
  pathname: string,
  options: StaticAssetsOptions,
  open: StaticFileOpener,
): Promise<Response | undefined> {
  const path = resolveStaticAssetPath(pathname, options);
  if (path === undefined) {
    return undefined;
  }
  const source = open(path);
  if (!(await source.exists)) {
    return undefined;
  }
  const headers = new Headers();
  if (options.maxAge !== undefined) {
    headers.set("cache-control", `public, max-age=${options.maxAge}`);
  }
  if (source.lastModified !== undefined) {
    headers.set("last-modified", new Date(source.lastModified).toUTCString());
  }
  return new Response(source.body, { headers });
}

/**
 * Validates and freezes the static directories an application declared.
 *
 * @param input - One directory, several, or none.
 * @returns The frozen directories, in declaration order.
 * @throws An `AponiaError` with `INVALID_CONFIGURATION_VALUE`.
 */
export function normalizeStaticAssets(
  input: StaticAssetsOptions | readonly StaticAssetsOptions[] | undefined,
): readonly StaticAssetsOptions[] {
  if (input === undefined) {
    return Object.freeze([]);
  }
  const entries = Array.isArray(input) ? input : [input];
  return Object.freeze(
    entries.map((entry) => {
      const issues: string[] = [];
      if (typeof entry.prefix !== "string") {
        issues.push('"staticAssets.prefix" must be a string');
      }
      if (typeof entry.root !== "string" || entry.root.trim() === "") {
        issues.push('"staticAssets.root" must be a non-empty string');
      }
      if (
        entry.index !== undefined &&
        (typeof entry.index !== "string" || entry.index.trim() === "")
      ) {
        issues.push('"staticAssets.index" must be a non-empty string when present');
      }
      if (entry.maxAge !== undefined && (!Number.isInteger(entry.maxAge) || entry.maxAge < 0)) {
        issues.push('"staticAssets.maxAge" must be a non-negative integer when present');
      }
      if (issues.length > 0) {
        throw new AponiaError("INVALID_CONFIGURATION_VALUE", "The static assets are invalid.", {
          issues: Object.freeze(issues),
        });
      }
      return Object.freeze({
        prefix: entry.prefix,
        root: entry.root,
        ...(entry.index === undefined ? {} : { index: entry.index }),
        ...(entry.maxAge === undefined ? {} : { maxAge: entry.maxAge }),
      });
    }),
  );
}
