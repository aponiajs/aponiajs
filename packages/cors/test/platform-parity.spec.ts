import { expect, test } from "bun:test";
import { Controller, Get, Module, defineConfiguration } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";

import { AponiaFactory as H3AponiaFactory } from "@aponiajs/platform-h3";
import { AponiaFactory as HonoAponiaFactory } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { z } from "zod";
import { CorsModule } from "../src/index.ts";

const CorsConfig = defineConfiguration(
  z
    .object({
      CORS_ORIGINS: z.string().min(1).default("https://app.example"),
      CORS_CREDENTIALS: z.enum(["true", "false"]).default("false"),
    })
    .transform(({ CORS_ORIGINS, CORS_CREDENTIALS }) => ({
      origins: CORS_ORIGINS.split(",").map((origin) => origin.trim()),
      credentials: CORS_CREDENTIALS === "true",
    })),
  "cors.parity",
);

@Controller("ping")
class PingController {
  @Get()
  ping(): string {
    return "pong";
  }
}

@Module({
  imports: [CorsModule.forRoot({ configuration: CorsConfig, source: {} })],
  controllers: [PingController],
})
class AppModule {}

interface Answer {
  readonly status: number;
  readonly allowOrigin: string | null;
  readonly vary: string | null;
  readonly allowCredentials: string | null;
}

async function answer(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const response = await fetch(
    new Request("http://localhost/ping", { headers: { origin: "https://app.example" } }),
  );
  return {
    status: response.status,
    allowOrigin: response.headers.get("access-control-allow-origin"),
    vary: response.headers.get("vary"),
    allowCredentials: response.headers.get("access-control-allow-credentials"),
  };
}

const expected: Answer = {
  status: 200,
  allowOrigin: "https://app.example",
  vary: "Origin",
  allowCredentials: null,
};

test("the same CORS registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await HonoAponiaFactory.create(AppModule, { logger: false });
  const h3 = await H3AponiaFactory.create(AppModule, { logger: false });

  try {
    const answers = {
      elysia: await answer((request) => elysia.handle(request)),
      hono: await answer((request) => hono.handle(request)),
      h3: await answer((request) => h3.handle(request)),
      // The Web Fetch delivery adapter is the Hono application behind a plain
      // `Request` → `Response` handler, which is what a worker runtime exports.
      serverless: await answer(toFetchHandler(hono)),
    };
    expect(answers).toEqual({
      elysia: expected,
      hono: expected,
      h3: expected,
      serverless: expected,
    });
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});

test("a denied origin is answered without an allow-origin header on every platform", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await HonoAponiaFactory.create(AppModule, { logger: false });
  const h3 = await H3AponiaFactory.create(AppModule, { logger: false });

  try {
    for (const application of [elysia, hono, h3]) {
      const response = await application.handle(
        new Request("http://localhost/ping", { headers: { origin: "https://evil.example" } }),
      );
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toBe("Origin");
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
