import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  AponiaError,
  Module,
  provideFactory,
  provideRequestLifecycleHook,
  provideRequestLifecycleHooksAsync,
  provideValue,
  requirePlatformCapabilities,
  resolveStaticAssetPath,
  type DynamicModule,
  type RequestLifecycleHook,
} from "@aponiajs/common";
import type {
  ServeStaticModuleAsyncOptions,
  ServeStaticModuleOptions,
} from "./interfaces/serve-static.interface.ts";

const SERVE_STATIC_OPTIONS = Symbol.for("aponia.serve-static.options");

const mimeTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/**
 * Nest-compatible `ServeStaticModule` that serves static files and optional SPA
 * fallbacks via a platform-neutral `RequestLifecycleHook`.
 */
@Module({})
export class ServeStaticModule {
  /** Registers one or more static file roots synchronously. */
  static forRoot(...options: readonly ServeStaticModuleOptions[]): DynamicModule {
    const normalized = normalizeOptions(options);
    return Object.freeze({
      id: "ServeStaticModule",
      instanceId: Symbol("ServeStaticModule.forRoot"),
      module: ServeStaticModule,
      providers: Object.freeze([
        requirePlatformCapabilities("serve-static", ["http"]),
        provideValue(SERVE_STATIC_OPTIONS, normalized),
        provideRequestLifecycleHook(createServeStaticHook(normalized)),
      ]),
      exports: Object.freeze([]),
    });
  }

  /** Registers one or more static file roots asynchronously. */
  static forRootAsync(options: ServeStaticModuleAsyncOptions): DynamicModule {
    return Object.freeze({
      id: "ServeStaticModule",
      instanceId: Symbol("ServeStaticModule.forRootAsync"),
      module: ServeStaticModule,
      imports: options.imports ?? [],
      providers: Object.freeze([
        requirePlatformCapabilities("serve-static", ["http"]),
        provideFactory(SERVE_STATIC_OPTIONS, options.inject ?? [], async (...args) => {
          const built = await options.useFactory(...(args as unknown as readonly never[]));
          const list = Array.isArray(built) ? built : [built as ServeStaticModuleOptions];
          return normalizeOptions(list);
        }),
        provideRequestLifecycleHooksAsync([SERVE_STATIC_OPTIONS], (resolved) =>
          createServeStaticHook(resolved as readonly ServeStaticModuleOptions[]),
        ),
      ]),
      exports: Object.freeze([]),
    });
  }
}

function normalizeOptions(
  options: readonly ServeStaticModuleOptions[],
): readonly ServeStaticModuleOptions[] {
  if (options.length === 0) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      "ServeStaticModule.forRoot() requires at least one ServeStaticModuleOptions entry.",
      { configuration: "ServeStaticModule" },
    );
  }
  for (const entry of options) {
    if (typeof entry.rootPath !== "string" || entry.rootPath.trim() === "") {
      throw new AponiaError(
        "INVALID_CONFIGURATION_VALUE",
        "ServeStaticModuleOptions.rootPath must be a non-empty string.",
        { configuration: "ServeStaticModule", field: "rootPath" },
      );
    }
  }
  return Object.freeze(options.map((entry) => Object.freeze({ ...entry })));
}

function createServeStaticHook(mounts: readonly ServeStaticModuleOptions[]): RequestLifecycleHook {
  return {
    name: "serve-static",
    onRequest: (request: Request): Response | undefined => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return undefined;
      }
      const pathname = new URL(request.url).pathname;

      for (const mount of mounts) {
        if (isExcluded(pathname, mount.exclude)) {
          continue;
        }
        const prefix = mount.serveRoot ?? "/";
        const index = mount.index === false ? "__disabled__" : (mount.index ?? "index.html");
        const candidate = resolveStaticAssetPath(pathname, {
          root: mount.rootPath,
          prefix,
          index,
        });
        if (candidate !== undefined) {
          const served = tryReadFileResponse(candidate, request.method === "HEAD");
          if (served !== undefined) {
            return served;
          }
        }
        if (mount.renderPath !== undefined && matchesRenderPath(pathname, mount.renderPath)) {
          const fallback = resolveStaticAssetPath(prefix, {
            root: mount.rootPath,
            prefix,
            index: mount.index === false ? "index.html" : (mount.index ?? "index.html"),
          });
          if (fallback !== undefined) {
            const served = tryReadFileResponse(fallback, request.method === "HEAD");
            if (served !== undefined) {
              return served;
            }
          }
        }
      }

      return undefined;
    },
  };
}

function isExcluded(pathname: string, patterns: readonly string[] | undefined): boolean {
  if (patterns === undefined || patterns.length === 0) {
    return false;
  }
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (pathname.startsWith(prefix)) {
        return true;
      }
    } else if (pathname === pattern || pathname.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

function matchesRenderPath(pathname: string, renderPath: string | RegExp): boolean {
  if (renderPath instanceof RegExp) {
    return renderPath.test(pathname);
  }
  if (renderPath === "*" || renderPath === "(.*)") {
    return true;
  }
  return pathname === renderPath || pathname.startsWith(renderPath);
}

function tryReadFileResponse(filePath: string, headOnly: boolean): Response | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      return undefined;
    }
    const contentType = mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const headers = { "content-type": contentType };
    if (headOnly) {
      return new Response(null, { status: 200, headers });
    }
    return new Response(readFileSync(fd), { status: 200, headers });
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
