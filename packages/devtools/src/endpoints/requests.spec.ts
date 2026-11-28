import { expect, test } from "bun:test";
import { Body, Controller, Get, Module, Post } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { DevtoolsModule, devtoolsPathPrefix, type AponiaRequestsPayload } from "../index.ts";

@Controller("greet")
class GreetController {
  @Get(":name")
  read(): string {
    return "hello";
  }

  @Post("/")
  create(@Body() body: { readonly name: string }): string {
    return body.name;
  }
}

let booted: AponiaApplication | undefined;

async function boot(capture?: false): Promise<AponiaApplication> {
  @Module({
    imports: [DevtoolsModule.forRoot({ enabled: true, capture })],
    controllers: [GreetController],
  })
  class AppModule {}

  booted = await AponiaFactory.create(AppModule, { logger: false });
  return booted;
}

async function requestsOf(
  application: AponiaApplication,
  since = 0,
): Promise<AponiaRequestsPayload> {
  const response = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/requests?since=${since}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as AponiaRequestsPayload;
}

test("records one request as a pending entry and its answer, sharing one id", async () => {
  const application = await boot();
  try {
    await application.handle(new Request("http://localhost/greet/ada"));
    const payload = await requestsOf(application);

    expect(payload.entries).toHaveLength(2);
    const [pending, answer] = payload.entries;
    expect(pending?.id).toBe(answer?.id);
    expect(pending?.status).toBeNull();
    expect(pending?.durationMs).toBeNull();
    expect(answer?.status).toBe(200);
    expect(answer?.path).toBe("/greet/:name");
    expect(answer?.url).toBe("/greet/ada");
    expect(answer?.method).toBe("GET");
    expect(typeof answer?.durationMs).toBe("number");
  } finally {
    await application.close();
  }
});

test("captures headers, and redacts the ones the policy names", async () => {
  @Module({
    imports: [
      DevtoolsModule.forRoot({
        enabled: true,
        capture: { redact: ["authorization"] },
      }),
    ],
    controllers: [GreetController],
  })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    await application.handle(
      new Request("http://localhost/greet/ada", {
        headers: { authorization: "Bearer secret", "x-trace": "trace-1" },
      }),
    );
    const payload = await requestsOf(application);
    const answer = payload.entries.at(-1);
    expect(answer?.headers?.["x-trace"]).toBe("trace-1");
    expect(answer?.headers?.authorization).toBe("[redacted]");
  } finally {
    await application.close();
  }
});

test("stores the request body as the text that arrived", async () => {
  const application = await boot();
  try {
    await application.handle(
      new Request("http://localhost/greet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ada" }),
      }),
    );
    const payload = await requestsOf(application);
    expect(payload.entries.at(-1)?.body).toBe('{"name":"ada"}');
  } finally {
    await application.close();
  }
});

test("a registration told to capture nothing writes no entry", async () => {
  const application = await boot(false);
  try {
    await application.handle(new Request("http://localhost/greet/ada"));
    const payload = await requestsOf(application);
    expect(payload).toEqual({ cursor: 0, entries: [] });
  } finally {
    await application.close();
  }
});

test("two applications keep their records apart", async () => {
  const first = await boot();
  try {
    await first.handle(new Request("http://localhost/greet/one"));
    const firstPayload = await requestsOf(first);

    const second = await boot();
    try {
      await second.handle(new Request("http://localhost/greet/two"));
      const secondPayload = await requestsOf(second);

      expect(firstPayload.entries.map((entry) => entry.url)).toContain("/greet/one");
      expect(secondPayload.entries.map((entry) => entry.url)).not.toContain("/greet/one");
      expect(secondPayload.entries.map((entry) => entry.url)).toContain("/greet/two");
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
});
