import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  provideClass,
  provideFactory,
  provideValue,
  Scope,
  type ProviderScope,
} from "@aponiajs/common";
import { AponiaContainer, compileModuleGraph, createContainer } from "../src/index.ts";

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected the operation to throw an AponiaError.");
}

describe("provider scopes", () => {
  test("boots providers that declare nothing and providers that declare singleton", () => {
    const plain = createToken<number>("scope.plain");
    const single = createToken<number>("scope.singleton");
    const container = createContainer(
      defineModule({
        id: "app",
        providers: [provideValue(plain, 1), provideValue(single, 2, { scope: Scope.DEFAULT })],
      }),
    );

    expect(container.get(plain)).toBe(1);
    expect(container.get(single)).toBe(2);
  });

  test("freezes the declared scope onto the provider", () => {
    const provider = provideValue(createToken<number>("scope.frozen"), 1, {
      scope: Scope.REQUEST,
    });

    expect(provider.scope).toBe(Scope.REQUEST);
    expect(Object.isFrozen(provider)).toBe(true);
  });

  test("refuses a provider declaring an unknown or unsupported scope", () => {
    const provider = provideValue(createToken<number>("scope.unknown"), 1, {
      scope: "custom" as ProviderScope,
    });
    const module = defineModule({ id: "app", providers: [provider] });

    const eager = captureAponiaError(() => {
      new AponiaContainer(compileModuleGraph(module)).initializeModule(module);
    });
    expect(eager.code).toBe("UNSUPPORTED_PROVIDER_SCOPE");
    expect(eager.details).toMatchObject({ token: "scope.unknown", scope: "custom" });
  });

  describe("transient scope", () => {
    test("instantiates a new instance on every resolution for class providers", () => {
      let counter = 0;
      class CounterService {
        readonly id = ++counter;
      }
      const token = createToken<CounterService>("counter.transient");
      const container = createContainer(
        defineModule({
          id: "app",
          providers: [provideClass(token, CounterService, [], { scope: Scope.TRANSIENT })],
        }),
      );

      const instance1 = container.get(token);
      const instance2 = container.get(token);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
    });

    test("instantiates a new instance on every resolution for factory providers", () => {
      let count = 0;
      const token = createToken<{ id: number }>("factory.transient");
      const container = createContainer(
        defineModule({
          id: "app",
          providers: [
            provideFactory(token, [], () => ({ id: ++count }), { scope: Scope.TRANSIENT }),
          ],
        }),
      );

      const a = container.get(token);
      const b = container.get(token);

      expect(a).not.toBe(b);
      expect(a.id).toBe(1);
      expect(b.id).toBe(2);
    });

    test("provides separate transient instances when injected into multiple consumers", () => {
      class LoggerService {
        static count = 0;
        readonly id = ++LoggerService.count;
      }
      class ServiceA {
        constructor(readonly logger: LoggerService) {}
      }
      class ServiceB {
        constructor(readonly logger: LoggerService) {}
      }

      const loggerToken = createToken<LoggerService>("logger");
      const serviceAToken = createToken<ServiceA>("serviceA");
      const serviceBToken = createToken<ServiceB>("serviceB");

      const container = createContainer(
        defineModule({
          id: "app",
          providers: [
            provideClass(loggerToken, LoggerService, [], { scope: Scope.TRANSIENT }),
            provideClass(serviceAToken, ServiceA, [loggerToken]),
            provideClass(serviceBToken, ServiceB, [loggerToken]),
          ],
        }),
      );

      const a = container.get(serviceAToken);
      const b = container.get(serviceBToken);

      expect(a.logger).not.toBe(b.logger);
      expect(a.logger.id).toBe(1);
      expect(b.logger.id).toBe(2);
    });
  });

  describe("request scope", () => {
    test("throws MISSING_REQUEST_CONTEXT when resolved outside an active request context", () => {
      const token = createToken<string>("request.token");
      const container = createContainer(
        defineModule({
          id: "app",
          providers: [provideValue(token, "hello", { scope: Scope.REQUEST })],
        }),
      );

      const error = captureAponiaError(() => container.get(token));
      expect(error.code).toBe("MISSING_REQUEST_CONTEXT");
      expect(error.details).toMatchObject({
        module: "app",
        token: "request.token",
      });
    });

    test("caches instances per request context and separates distinct request contexts", () => {
      let counter = 0;
      class RequestTracker {
        readonly id = ++counter;
      }
      const token = createToken<RequestTracker>("request.tracker");
      const container = createContainer(
        defineModule({
          id: "app",
          providers: [provideClass(token, RequestTracker, [], { scope: Scope.REQUEST })],
        }),
      );

      const context1 = { requestId: "req-1" };
      const context2 = { requestId: "req-2" };

      const c1InstanceA = container.get(token, context1);
      const c1InstanceB = container.get(token, context1);
      const c2Instance = container.get(token, context2);

      expect(c1InstanceA).toBe(c1InstanceB);
      expect(c1InstanceA).not.toBe(c2Instance);
      expect(c1InstanceA.id).toBe(1);
      expect(c2Instance.id).toBe(2);
    });

    test("resolves through ambient request context accessor", () => {
      let activeContext: object | undefined;
      let counter = 0;
      class RequestService {
        readonly id = ++counter;
      }
      const token = createToken<RequestService>("ambient.req");
      const container = createContainer(
        defineModule({
          id: "app",
          providers: [provideClass(token, RequestService, [], { scope: Scope.REQUEST })],
        }),
      );

      container.setRequestContextAccessor(() => activeContext);

      // Outside context
      expect(() => container.get(token)).toThrow(
        expect.objectContaining({ code: "MISSING_REQUEST_CONTEXT" }),
      );

      // In Request 1
      activeContext = { id: "req-1" };
      const req1A = container.get(token);
      const req1B = container.get(token);
      expect(req1A).toBe(req1B);
      expect(req1A.id).toBe(1);

      // In Request 2
      activeContext = { id: "req-2" };
      const req2 = container.get(token);
      expect(req2).not.toBe(req1A);
      expect(req2.id).toBe(2);
    });

    test("allows request-scoped providers to depend on other request-scoped and singleton providers", () => {
      class ConfigService {
        readonly env = "production";
      }
      class RequestHeaderService {
        readonly header = "Bearer abc";
      }
      class AuthContextService {
        constructor(
          readonly config: ConfigService,
          readonly headers: RequestHeaderService,
        ) {}
      }

      const configToken = createToken<ConfigService>("config");
      const headerToken = createToken<RequestHeaderService>("headers");
      const authContextToken = createToken<AuthContextService>("authContext");

      const container = createContainer(
        defineModule({
          id: "app",
          providers: [
            provideClass(configToken, ConfigService, [], { scope: Scope.DEFAULT }),
            provideClass(headerToken, RequestHeaderService, [], { scope: Scope.REQUEST }),
            provideClass(authContextToken, AuthContextService, [configToken, headerToken], {
              scope: Scope.REQUEST,
            }),
          ],
        }),
      );

      const ctx = {};
      const auth = container.get(authContextToken, ctx);
      expect(auth.config.env).toBe("production");
      expect(auth.headers.header).toBe("Bearer abc");
    });
  });

  describe("scope hierarchy validation", () => {
    test("rejects singleton provider depending on request-scoped provider with INVALID_SCOPE_HIERARCHY", () => {
      const requestToken = createToken<string>("req.dep");
      const singletonToken = createToken<string>("singleton.target");

      const module = defineModule({
        id: "bad-hierarchy",
        providers: [
          provideValue(requestToken, "req", { scope: Scope.REQUEST }),
          provideFactory(singletonToken, [requestToken], (val) => `val: ${val}`, {
            scope: Scope.DEFAULT,
          }),
        ],
      });

      const error = captureAponiaError(() => compileModuleGraph(module));
      expect(error.code).toBe("INVALID_SCOPE_HIERARCHY");
      expect(error.details).toMatchObject({
        module: "bad-hierarchy",
        provider: "singleton.target",
        providerScope: "singleton",
        dependency: "req.dep",
        dependencyScope: "request",
      });
    });

    test("rejects controller depending on request-scoped provider with INVALID_SCOPE_HIERARCHY", () => {
      const requestToken = createToken<string>("req.service");
      class ControllerTarget {}

      const module = defineModule({
        id: "bad-controller-hierarchy",
        providers: [provideValue(requestToken, "req", { scope: Scope.REQUEST })],
        controllers: [
          {
            kind: "test",
            token: ControllerTarget,
            inject: [requestToken],
            useClass: ControllerTarget,
          },
        ],
      });

      const error = captureAponiaError(() => compileModuleGraph(module));
      expect(error.code).toBe("INVALID_SCOPE_HIERARCHY");
      expect(error.details).toMatchObject({
        module: "bad-controller-hierarchy",
        controller: "ControllerTarget",
        dependency: "req.service",
        dependencyScope: "request",
      });
    });
  });
});
