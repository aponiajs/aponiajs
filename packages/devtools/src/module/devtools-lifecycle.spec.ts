import { expect, test } from "bun:test";
import {
  Controller,
  Get,
  Module,
  Post,
  type ClassToken,
  type LoggerService,
} from "@aponiajs/common";
import { AponiaFactory, HttpError, type AponiaApplication } from "@aponiajs/platform-elysia";
import { DevtoolsModule, devtoolsPathPrefix, type AponiaRequestsPayload } from "../index.ts";

/**
 * The controller half of the surface and the request-record hook, driven
 * through a real boot. Every endpoint is mounted as an ordinary `GET`, so a
 * case asserts the answer a client receives on the application's own address;
 * the record cases assert what the lifecycle hook wrote after the request ran.
 */

@Controller("greet")
class GreetController {
  @Get()
  read(): string {
    return "hello";
  }

  @Post()
  create(): string {
    return "created";
  }
}

@Controller("fail")
class FailController {
  @Get()
  read(): never {
    throw new HttpError(418);
  }
}

@Controller("boom")
class BoomController {
  @Get()
  read(): never {
    throw new Error("boom");
  }
}

@Controller("status-code")
class StatusCodeController {
  @Get()
  read(): never {
    throw Object.assign(new Error("teapot"), { statusCode: 418 });
  }
}

async function boot(
  options: Parameters<typeof DevtoolsModule.forRoot>[0],
  controllers: readonly ClassToken<unknown>[] = [GreetController],
): Promise<AponiaApplication> {
  @Module({
    imports: [DevtoolsModule.forRoot(options)],
    controllers: controllers as never,
  })
  class AppModule {}

  return await AponiaFactory.create(AppModule, { logger: false });
}

async function requestsOf(application: AponiaApplication): Promise<AponiaRequestsPayload> {
  const response = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/requests`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as AponiaRequestsPayload;
}

test("the mounted controller answers routes, flow, graph, and the aot path", async () => {
  const application = await boot({ enabled: true });
  try {
    const routes = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/routes`),
    );
    expect(routes.status).toBe(200);
    const routesPayload = (await routes.json()) as {
      routes: { method: string; path: string; handler: string }[];
    };
    expect(routesPayload.routes).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/greet", handler: "read" }),
    );

    const flow = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/flow`),
    );
    expect(flow.status).toBe(200);
    const flowPayload = (await flow.json()) as {
      routes: { id: string; stages: { kind: string }[] }[];
    };
    const greet = flowPayload.routes.find((route) => route.id === "GET /greet");
    expect(greet?.stages.map((stage) => stage.kind)).toEqual(["invoke", "handler"]);

    const graph = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/graph`),
    );
    expect(graph.status).toBe(200);
    expect(((await graph.json()) as { rootModule: string }).rootModule).toBe("AppModule");

    // This boot adopted no invoker artifact, so the record states a refusal and
    // `/aot` answers the boot half with a degraded controller list.
    const aot = await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/aot`));
    expect(aot.status).toBe(200);
    const aotPayload = (await aot.json()) as {
      graph: string;
      invokers: { accepted: boolean };
      controllers: unknown[];
    };
    expect(aotPayload.graph).toBe("decorated");
    expect(aotPayload.invokers.accepted).toBe(false);
    expect(aotPayload.controllers).toEqual([]);
  } finally {
    await application.close();
  }
});

test("an authorize hook that throws denies the request rather than failing the surface", async () => {
  const application = await boot({
    enabled: true,
    authorize: () => {
      throw new Error("the policy refused to decide");
    },
  });
  try {
    const response = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/meta`),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally {
    await application.close();
  }
});

test("a registration told not to tap a logger serves no log endpoint", async () => {
  const application = await boot({ enabled: true, logger: false });
  try {
    const logs = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/logs`),
    );
    expect(logs.status).toBe(404);
  } finally {
    await application.close();
  }
});

test("a logger the registration names is tapped for the levels it carries", async () => {
  const lines: string[] = [];
  const logger: LoggerService = {
    log: (message) => lines.push(String(message)),
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };
  const application = await boot({ enabled: true, logger });
  try {
    const logs = await application.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/logs`),
    );
    expect(logs.status).toBe(200);
    const payload = (await logs.json()) as { levels: string[] };
    expect(payload.levels).toEqual(["log", "fatal", "error", "warn"]);
  } finally {
    await application.close();
  }
});

test("the record states the status an HttpError declares", async () => {
  const application = await boot({ enabled: true }, [FailController] as never);
  try {
    expect((await application.handle(new Request("http://localhost/fail"))).status).toBe(418);

    const payload = await requestsOf(application);
    const [pending, answer] = payload.entries;
    expect(pending?.status).toBeNull();
    expect(pending?.id).toBe(answer?.id);
    expect(answer?.status).toBe(418);
    expect(answer?.path).toBe("/fail");
    expect(Object.hasOwn(answer!, "error")).toBe(false);
  } finally {
    await application.close();
  }
});

test("a failed request records the exception's message and a 500", async () => {
  const application = await boot({ enabled: true }, [BoomController] as never);
  try {
    expect((await application.handle(new Request("http://localhost/boom"))).status).toBe(500);

    const answer = (await requestsOf(application)).entries.at(-1);
    expect(answer?.status).toBe(500);
    expect(answer?.error).toBe("boom");
  } finally {
    await application.close();
  }
});

test("an exception that declares only a statusCode is recorded with that status", async () => {
  const application = await boot({ enabled: true }, [StatusCodeController] as never);
  try {
    await application.handle(new Request("http://localhost/status-code"));

    const answer = (await requestsOf(application)).entries.at(-1);
    expect(answer?.status).toBe(418);
  } finally {
    await application.close();
  }
});

test("an unanswered POST keeps the body the arrival captured", async () => {
  const application = await boot({ enabled: true });
  try {
    await application.handle(
      new Request("http://localhost/greet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"name":"ada"}',
      }),
    );

    const answer = (await requestsOf(application)).entries.at(-1);
    expect(answer?.body).toBe('{"name":"ada"}');
    expect(answer?.status).toBe(200);
  } finally {
    await application.close();
  }
});
