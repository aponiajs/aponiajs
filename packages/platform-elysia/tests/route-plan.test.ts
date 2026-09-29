import { expect, test } from "bun:test";
import { defineModule, provideClass, type ClassToken, type LoggerService } from "@aponiajs/common";
import { Elysia, t } from "elysia";
import {
  AponiaFactory,
  defineElysiaControllerRoutes,
  type AponiaControllerInvokerFactory,
  type AponiaInvokerArtifact,
  type AponiaRouteInvoker,
  type ElysiaRoutePlan,
} from "../src/index.ts";

const frameworkVersion = (
  (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { version: string }
).version;

/**
 * A controller that declares nothing through decorators. Everything the platform
 * needs — dependencies, routes, parameters, schema, and how a handler is called
 * — comes from the plan below, which is the state build-time descriptor
 * generation puts an application in.
 */
class DeclaredUsersService {
  tag(): string {
    return "service";
  }
}

class DeclaredUsersController {
  readonly #service: DeclaredUsersService;

  constructor(service: DeclaredUsersService) {
    this.#service = service;
  }

  read(id: string): string {
    return `read:${id}`;
  }

  create(body: { name: string }): string {
    return `created:${body.name}`;
  }

  ping(): string {
    return this.#service.tag();
  }

  readContext(context: { readonly request: Request }): string {
    return `method:${context.request.method}`;
  }

  readAsync(): Promise<string> {
    return Promise.resolve("resolved");
  }
}

const declaredRoutes: readonly ElysiaRoutePlan[] = [
  {
    method: "GET",
    path: ":id",
    propertyKey: "read",
    parameters: [{ index: 0, kind: "params", property: "id" }],
  },
  {
    method: "POST",
    path: "",
    propertyKey: "create",
    parameters: [{ index: 0, kind: "body", property: undefined }],
    schema: { body: t.Object({ name: t.String({ minLength: 2 }) }) },
  },
  { method: "GET", path: "ping", propertyKey: "ping" },
  { method: "GET", path: "context", propertyKey: "readContext", takesContext: true },
  { method: "GET", path: "async", propertyKey: "readAsync", promiseCapable: true },
];

const declaredModule = defineModule({
  id: "DeclaredUsersModule",
  providers: [provideClass(DeclaredUsersService, [])],
  controllers: [
    defineElysiaControllerRoutes(DeclaredUsersController, {
      path: "/users",
      inject: [DeclaredUsersService],
      routes: declaredRoutes,
    }),
  ],
});

test("serves a controller whose routes were declared as data", async () => {
  const application = await AponiaFactory.create(declaredModule, { logger: false });

  const read = await application.handle(new Request("http://localhost/users/7"));
  expect(read.status).toBe(200);
  expect(await read.text()).toBe("read:7");

  await application.close();
});

test("resolves a declared controller's dependencies without decorator metadata", async () => {
  const application = await AponiaFactory.create(declaredModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/users/ping"));

  expect(await response.text()).toBe("service");
  await application.close();
});

test("lowers a declared schema into route validation", async () => {
  const application = await AponiaFactory.create(declaredModule, { logger: false });
  const post = (body: unknown): Request =>
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const accepted = await application.handle(post({ name: "Ada" }));
  expect(accepted.status).toBe(200);
  expect(await accepted.text()).toBe("created:Ada");

  const rejected = await application.handle(post({ name: "A" }));
  expect(rejected.status).toBe(422);

  await application.close();
});

test("gives a declared handler the whole context only when the plan says so", async () => {
  const application = await AponiaFactory.create(declaredModule, { logger: false });

  const withContext = await application.handle(new Request("http://localhost/users/context"));
  expect(await withContext.text()).toBe("method:GET");

  await application.close();
});

test("awaits a declared promise-capable route", async () => {
  const application = await AponiaFactory.create(declaredModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/users/async"));

  expect(await response.text()).toBe("resolved");
  await application.close();
});

test("compiles a declared handler that is not promise-capable synchronously", async () => {
  let observedResponse: unknown;
  const application = await AponiaFactory.create(declaredModule, {
    logger: false,
    configureNative: (nativeApplication) =>
      nativeApplication.afterHandle(({ responseValue }) => {
        observedResponse = responseValue;
      }),
  });

  const response = await application.handle(new Request("http://localhost/users/ping"));
  expect(await response.text()).toBe("service");
  // A synchronous handler that really is synchronous leaves the hook a value
  // rather than a Promise, which is what the declared kind decides.
  expect(observedResponse).toBe("service");
  await application.close();
});

/**
 * Two declared controllers claiming one route. Neither is decorated, so this
 * also proves the duplicate check reasons over declared plans rather than only
 * over decorator metadata.
 */
class FirstClaimController {
  read(): string {
    return "first";
  }
}

class SecondClaimController {
  read(): string {
    return "second";
  }
}

const claimingModule = defineModule({
  id: "ClaimingModule",
  controllers: [
    defineElysiaControllerRoutes(FirstClaimController, {
      path: "/claim",
      routes: [{ method: "GET", path: ":id", propertyKey: "read" }],
    }),
    defineElysiaControllerRoutes(SecondClaimController, {
      path: "/claim",
      routes: [{ method: "GET", path: ":id", propertyKey: "read" }],
    }),
  ],
});

test("rejects a route two declared controllers claim", async () => {
  const error = await AponiaFactory.create(claimingModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "DUPLICATE_ROUTE",
      details: expect.objectContaining({ method: "GET", path: "/claim/:id" }),
    }),
  );
});

class RecordingLogger implements LoggerService {
  readonly records: string[] = [];

  log(message: unknown): void {
    this.records.push(String(message));
  }

  fatal(): void {}

  error(): void {}

  warn(): void {}
}

test("prefers a generated invoker for a declared controller's handler", async () => {
  const artifact: AponiaInvokerArtifact = Object.freeze({
    framework: frameworkVersion,
    elysia: "1.4.30",
    invokers: new Map<ClassToken<unknown>, AponiaControllerInvokerFactory>([
      [
        DeclaredUsersController as ClassToken<unknown>,
        (() =>
          new Map<string | symbol, AponiaRouteInvoker>([
            ["ping", () => "from-invoker"],
          ])) as unknown as AponiaControllerInvokerFactory,
      ],
    ]),
  });
  const application = await AponiaFactory.create(declaredModule, {
    logger: false,
    invokers: artifact,
  });

  const response = await application.handle(new Request("http://localhost/users/ping"));
  expect(await response.text()).toBe("from-invoker");
  await application.close();
});

test("logs a declared controller's routes at startup", async () => {
  const logger = new RecordingLogger();
  const application = await AponiaFactory.create(declaredModule, { logger });

  expect(logger.records.some((record) => record.includes("/users/:id"))).toBe(true);
  await application.close();
});

test("builds a plugin from a declared controller for the fallback path", async () => {
  const definition = defineElysiaControllerRoutes(DeclaredUsersController, {
    path: "/users",
    inject: [DeclaredUsersService],
    routes: [{ method: "GET", path: "ping", propertyKey: "ping" }],
  });
  const plugin = definition.buildPlugin(new DeclaredUsersController(new DeclaredUsersService()));
  const application = new Elysia().use(plugin);

  const response = await application.handle(new Request("http://localhost/users/ping"));
  expect(await response.text()).toBe("service");
});
