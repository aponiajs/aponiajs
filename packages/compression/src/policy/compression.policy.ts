import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { AponiaError } from "@aponiajs/common";
import type { HttpPolicy } from "@aponiajs/platform-core";

import type {
  CompressionModuleOptions,
  ResolvedCompressionOptions,
} from "../interfaces/compression.interface.ts";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const defaultThresholdBytes = 1_024;

/** Validates one registration and answers the policy it builds. */
export function resolveCompressionOptions(
  options: CompressionModuleOptions,
): ResolvedCompressionOptions {
  const thresholdBytes = options.thresholdBytes ?? defaultThresholdBytes;
  const encodings = options.encodings ?? ["br", "gzip"];
  const issues: string[] = [];

  if (!Number.isInteger(thresholdBytes) || thresholdBytes < 0) {
    issues.push("thresholdBytes must be a non-negative integer");
  }
  if (
    !Array.isArray(encodings) ||
    encodings.length === 0 ||
    encodings.some((encoding) => encoding !== "br" && encoding !== "gzip")
  ) {
    issues.push('encodings must be a non-empty array of "br" or "gzip"');
  }
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_COMPRESSION_OPTIONS",
      `The compression registration is invalid: ${issues.join("; ")}.`,
      { issues: Object.freeze(issues) },
    );
  }

  return Object.freeze({
    thresholdBytes,
    encodings: Object.freeze([...new Set(encodings)]),
  });
}

/**
 * Builds the neutral response policy one registration contributes.
 *
 * The policy transforms a `Response`, so it runs on every platform through the
 * shared pipeline rather than mounting a runtime plugin.
 */
export function buildCompressionPolicy(options: ResolvedCompressionOptions): HttpPolicy {
  return {
    name: "compression",
    async onResponse(request, response) {
      const compressed = await compressResponse(response, request, options);
      return compressed ?? response;
    },
  };
}

async function compressResponse(
  response: Response,
  request: Request,
  options: ResolvedCompressionOptions,
): Promise<Response | undefined> {
  if (request.method === "HEAD") {
    return undefined;
  }
  if (response.status === 204 || response.status === 206 || response.status === 304) {
    return undefined;
  }
  if (response.body === null) {
    return undefined;
  }
  if (response.headers.has("content-encoding")) {
    return undefined;
  }
  const contentType = response.headers.get("content-type");
  // An event stream never ends: buffering it would hang the request.
  if (contentType !== null && contentType.startsWith("text/event-stream")) {
    return undefined;
  }
  // A runtime that serialized a handler value without stating its type is
  // treated as text. A stated type that is not compressible is left alone.
  if (contentType !== null && !isCompressible(contentType)) {
    return undefined;
  }
  const encoding = selectEncoding(request.headers.get("accept-encoding"), options);
  if (encoding === undefined) {
    return undefined;
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) < options.thresholdBytes) {
    return undefined;
  }

  const payload = new Uint8Array(await response.clone().arrayBuffer());
  if (payload.byteLength < options.thresholdBytes) {
    return undefined;
  }
  const compressed = await compress(payload, encoding);
  const headers = new Headers(response.headers);
  headers.set("content-encoding", encoding);
  headers.set("content-length", String(compressed.byteLength));
  headers.set("vary", appendVary(headers.get("vary") ?? undefined, "accept-encoding"));
  return new Response(compressed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isCompressible(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("application/json") ||
    type.includes("+json") ||
    type.includes("application/javascript") ||
    type.includes("application/xml") ||
    type.includes("image/svg+xml")
  );
}

function selectEncoding(
  acceptEncoding: string | null,
  options: ResolvedCompressionOptions,
): "br" | "gzip" | undefined {
  if (acceptEncoding === null) {
    return undefined;
  }
  const accepted = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    if (name === undefined || name === "") {
      continue;
    }
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const q = quality === undefined ? 1 : Number(quality.trim().slice(2));
    accepted.set(name, Number.isFinite(q) ? q : 0);
  }
  for (const encoding of options.encodings) {
    if ((accepted.get(encoding) ?? accepted.get("*") ?? 0) > 0) {
      return encoding;
    }
  }
  return undefined;
}

function appendVary(current: string | number | string[] | undefined, value: string): string {
  const normalized = Array.isArray(current)
    ? current.join(", ")
    : current === undefined
      ? ""
      : String(current);
  const parts = new Set(
    normalized
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== ""),
  );
  parts.add(value);
  return [...parts].join(", ");
}

async function compress(payload: Uint8Array, encoding: "br" | "gzip"): Promise<Uint8Array> {
  const buffer = await (encoding === "br" ? brotli(payload) : gzipAsync(payload));
  return new Uint8Array(buffer);
}
