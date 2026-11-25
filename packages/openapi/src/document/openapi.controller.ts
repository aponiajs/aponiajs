import { Controller, Get, Inject, createToken } from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { buildOpenApiDocument, type OpenApiDocument } from "./openapi-document.ts";
import type { OpenApiInfo } from "../interfaces/openapi-document.interface.ts";

/** What one registration's controller reads. @internal */
export interface OpenApiRuntime {
  readonly info: OpenApiInfo;
  readonly mountPath: string;
  readonly container: () => AponiaContainer | undefined;
}

/** The runtime token the generated controller injects. @internal */
export const OPENAPI_RUNTIME = createToken<OpenApiRuntime>("aponia.openapi.runtime");

/**
 * Builds the controller one registration mounts its document and UI on.
 *
 * The document is built on the first request and kept: the route table a boot
 * mounts does not change after it starts, and a document built once is the same
 * document every client reads.
 *
 * @internal
 */
export function createOpenApiController(mountPath: string): new (runtime: OpenApiRuntime) => {
  document(): Promise<Response>;
  page(): Promise<Response>;
} {
  class OpenApiController {
    readonly #runtime: OpenApiRuntime;
    #document: OpenApiDocument | undefined;

    constructor(runtime: OpenApiRuntime) {
      this.#runtime = runtime;
    }

    page(): Promise<Response> {
      return Promise.resolve(
        new Response(uiPage(mountPath), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }

    document(): Promise<Response> {
      const container = this.#runtime.container();
      if (container === undefined) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      this.#document ??= buildOpenApiDocument(container, this.#runtime.info, mountPath);
      return Promise.resolve(
        Response.json(this.#document, {
          headers: { "cache-control": "no-store" },
        }),
      );
    }
  }

  Controller(mountPath)(OpenApiController);
  (Get("") as unknown as (target: object, key: string) => void)(
    OpenApiController.prototype,
    "page",
  );
  (Get("json") as unknown as (target: object, key: string) => void)(
    OpenApiController.prototype,
    "document",
  );
  Inject(OPENAPI_RUNTIME)(OpenApiController, undefined, 0);

  return OpenApiController as unknown as new (runtime: OpenApiRuntime) => {
    document(): Promise<Response>;
    page(): Promise<Response>;
  };
}

function uiPage(mountPath: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>API documentation</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; }
      code { background: #f4f4f4; padding: 0.1rem 0.3rem; }
    </style>
  </head>
  <body>
    <h1>API documentation</h1>
    <p>The OpenAPI document is served as JSON at <code>${mountPath}/json</code>.</p>
    <p>Import it into any OpenAPI viewer or client generator.</p>
  </body>
</html>`;
}
