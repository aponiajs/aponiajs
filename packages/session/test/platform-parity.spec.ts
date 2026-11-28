import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory as ElysiaFactory } from "@aponiajs/platform-elysia";

import { AponiaFactory as H3AponiaFactory } from "@aponiajs/platform-h3";
import { AponiaFactory as HonoAponiaFactory } from "@aponiajs/platform-hono";
import { toFetchHandler } from "@aponiajs/serverless";
import { SessionModule, SessionService } from "../src/index.ts";

const secret = "a".repeat(32);

@Controller("session")
class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get("start")
  async start(): Promise<string> {
    await this.sessions.start({ user: "ada" });
    return "started";
  }
}

@Module({
  imports: [SessionModule.forRoot({ secret })],
  controllers: [SessionController],
})
class AppModule {}

interface Answer {
  readonly status: number;
  readonly body: string;
  readonly cookieName: string | undefined;
  readonly httpOnly: boolean;
}

async function answer(fetch: (request: Request) => Response | Promise<Response>): Promise<Answer> {
  const response = await fetch(new Request("http://localhost/session/start"));
  const setCookie = response.headers.get("set-cookie") ?? "";
  return {
    status: response.status,
    body: await response.text(),
    cookieName: setCookie.split("=")[0],
    httpOnly: /HttpOnly/i.test(setCookie),
  };
}

test("the same session registration writes the same cookie on every platform", async () => {
  const elysia = await ElysiaFactory.create(AppModule, { logger: false });
  const hono = await HonoAponiaFactory.create(AppModule, { logger: false });
  const h3 = await H3AponiaFactory.create(AppModule, { logger: false });

  try {
    const answers = {
      elysia: await answer((request) => elysia.handle(request)),
      hono: await answer((request) => hono.handle(request)),
      h3: await answer((request) => h3.handle(request)),
      serverless: await answer(toFetchHandler(hono)),
    };
    for (const observed of Object.values(answers)) {
      expect(observed.status).toBe(200);
      expect(observed.body).toBe("started");
      expect(observed.cookieName).toBe("aponia.sid");
      expect(observed.httpOnly).toBe(true);
    }
  } finally {
    await elysia.close();
    await hono.close();
    await h3.close();
  }
});
