import { afterEach, describe, expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { AponiaError, Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { CompressionModule } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("CompressionModule", () => {
  test("gzip-compresses a large string above the threshold", async () => {
    @Controller("large")
    class LargeController {
      @Get()
      read(): string {
        return "a".repeat(2_000);
      }
    }

    @Module({
      imports: [CompressionModule.register({ thresholdBytes: 100 })],
      controllers: [LargeController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/large", { headers: { "accept-encoding": "gzip" } }),
    );

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("accept-encoding");
    const body = gunzipSync(new Uint8Array(await response.arrayBuffer())).toString();
    expect(body).toBe("a".repeat(2_000));
  });

  test("prefers Brotli when both encodings are accepted", async () => {
    @Controller("brotli")
    class BrotliController {
      @Get()
      read(): string {
        return "b".repeat(2_000);
      }
    }

    @Module({
      imports: [CompressionModule.register({ thresholdBytes: 100 })],
      controllers: [BrotliController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/brotli", {
        headers: { "accept-encoding": "gzip, br" },
      }),
    );

    expect(response.headers.get("content-encoding")).toBe("br");
    const body = brotliDecompressSync(new Uint8Array(await response.arrayBuffer())).toString();
    expect(body).toBe("b".repeat(2_000));
  });

  test("leaves a small response, a missing accept-encoding, and a bodyless response alone", async () => {
    @Controller("small")
    class SmallController {
      @Get()
      read(): string {
        return "small";
      }
    }

    @Module({
      imports: [CompressionModule.register({ thresholdBytes: 100 })],
      controllers: [SmallController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    const small = await application.handle(
      new Request("http://localhost/small", { headers: { "accept-encoding": "gzip" } }),
    );
    expect(small.headers.get("content-encoding")).toBeNull();

    const noEncoding = await application.handle(new Request("http://localhost/small"));
    expect(noEncoding.headers.get("content-encoding")).toBeNull();

    const head = await application.handle(
      new Request("http://localhost/small", {
        method: "HEAD",
        headers: { "accept-encoding": "gzip" },
      }),
    );
    expect(head.headers.get("content-encoding")).toBeNull();
  });

  test("compresses a Response object and preserves its status", async () => {
    @Controller("response")
    class ResponseController {
      @Get()
      read(): Response {
        return new Response(JSON.stringify({ value: "c".repeat(2_000) }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
    }

    @Module({
      imports: [CompressionModule.register({ thresholdBytes: 100 })],
      controllers: [ResponseController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(
      new Request("http://localhost/response", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const body = gunzipSync(new Uint8Array(await response.arrayBuffer())).toString();
    expect(JSON.parse(body)).toEqual({ value: "c".repeat(2_000) });
  });

  test("reports invalid compression options", () => {
    const error = captureAponiaError(() =>
      CompressionModule.register({ thresholdBytes: -1, encodings: [] }),
    );

    expect(error.code).toBe("INVALID_COMPRESSION_OPTIONS");
    expect(error.details).toEqual({
      issues: [
        "thresholdBytes must be a non-negative integer",
        'encodings must be a non-empty array of "br" or "gzip"',
      ],
    });
  });
});

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
