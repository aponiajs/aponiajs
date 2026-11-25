import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";
import { createPlatformFactory } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { SecurityModule } from "../src/index.ts";

@Controller("open")
class OpenController {
  @Get()
  read(): string {
    return "ok";
  }
}

@Module({
  imports: [SecurityModule.forRoot()],
  controllers: [OpenController],
})
class AppModule {}

interface Answer {
  readonly status: number;
  readonly frameOptions: string | null;
  readonly contentTypeOptions: string | null;
  readonly referrerPolicy: string | null;
}

async function answer(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const response = await fetch(new Request("http://localhost/open"));
  return {
    status: response.status,
    frameOptions: response.headers.get("x-frame-options"),
    contentTypeOptions: response.headers.get("x-content-type-options"),
    referrerPolicy: response.headers.get("referrer-policy"),
  };
}

test("the same security registration answers identically on every platform", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await createPlatformFactory(honoAdapter()).create(AppModule, { logger: false });
  const h3 = await createPlatformFactory(h3Adapter()).create(AppModule, { logger: false });

  try {
    const answers = {
      elysia: await answer((request) => elysia.handle(request)),
      hono: await answer((request) => hono.handle(request)),
      h3: await answer((request) => h3.handle(request)),
      serverless: await answer(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed).toEqual({
        status: 200,
        frameOptions: "DENY",
        contentTypeOptions: "nosniff",
        referrerPolicy: "no-referrer",
      });
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});

test("the headers also cover a request no route matched on every platform", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await createPlatformFactory(honoAdapter()).create(AppModule, { logger: false });
  const h3 = await createPlatformFactory(h3Adapter()).create(AppModule, { logger: false });

  try {
    for (const application of [elysia, hono, h3]) {
      const response = await application.handle(new Request("http://localhost/missing"));
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
