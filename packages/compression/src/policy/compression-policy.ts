import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { AponiaError } from "@aponiajs/common";
import type { ElysiaPlugin } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import type {
  CompressionModuleOptions,
  ResolvedCompressionOptions,
} from "../module/compression.types.ts";

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

/** Builds the native Elysia plugin one registration mounts. */
export function buildCompressionPlugin(options: ResolvedCompressionOptions): ElysiaPlugin {
  return new Elysia({ name: "aponia:compression", seed: options }).afterHandle(
    "global",
    async (context) => {
      if (context.request.method === "HEAD") {
        return;
      }
      if (context.responseValue instanceof Response) {
        return await compressResponse(context.responseValue, context.request, options);
      }

      const headers = context.set.headers;
      const status = typeof context.set.status === "number" ? context.set.status : 200;
      if (status === 204 || status === 206 || status === 304) {
        return;
      }
      if (headers["content-encoding"] !== undefined) {
        return;
      }

      const contentType =
        normalizeHeader(headers["content-type"]) ||
        (typeof context.responseValue === "string"
          ? "text/plain; charset=utf-8"
          : "application/json");
      if (!isCompressible(contentType)) {
        return;
      }
      const encoding = selectEncoding(context.request.headers.get("accept-encoding"), options);
      if (encoding === undefined) {
        return;
      }

      const payload = toBytes(context.responseValue, contentType);
      if (payload === undefined || payload.byteLength < options.thresholdBytes) {
        return;
      }
      const compressed = await compress(payload, encoding);
      headers["content-encoding"] = encoding;
      headers["content-length"] = compressed.byteLength;
      headers["vary"] = appendVary(headers["vary"], "accept-encoding");
      return compressed;
    },
  );
}

async function compressResponse(
  response: Response,
  request: Request,
  options: ResolvedCompressionOptions,
): Promise<Response | undefined> {
  if (response.status === 204 || response.status === 206 || response.status === 304) {
    return undefined;
  }
  if (response.headers.has("content-encoding")) {
    return undefined;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!isCompressible(contentType)) {
    return undefined;
  }
  const encoding = selectEncoding(request.headers.get("accept-encoding"), options);
  if (encoding === undefined) {
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

function toBytes(response: unknown, contentType: string): Uint8Array | undefined {
  if (response === null || response === undefined) {
    return undefined;
  }
  if (typeof response === "string") {
    return new TextEncoder().encode(response);
  }
  if (response instanceof Uint8Array) {
    return response;
  }
  if (response instanceof ArrayBuffer) {
    return new Uint8Array(response);
  }
  if (contentType.includes("application/json") || typeof response === "object") {
    return new TextEncoder().encode(JSON.stringify(response));
  }
  return undefined;
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

function normalizeHeader(value: string | number | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value === undefined ? "" : String(value);
}

function appendVary(current: string | number | string[] | undefined, value: string): string {
  const parts = new Set(
    normalizeHeader(current)
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
