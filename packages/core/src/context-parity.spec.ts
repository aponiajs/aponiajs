import { describe, expect, test } from "bun:test";
import {
  APP_GUARD,
  Scope,
  createToken,
  defineModule,
  provideClass,
  provideFactory,
  provideValue,
  type AponiaError,
  type CanActivate,
  type ModuleDefinition,
  type ProviderScope,
} from "@aponiajs/common";
import {
  CONTEXT,
  ContextIdFactory,
  INQUIRER,
  ModuleRef,
  REQUEST,
  createContainer,
  type ContextId,
} from "./index.ts";

function failureOf(work: () => unknown): AponiaError {
  try {
    work();
  } catch (error) {
    return error as AponiaError;
  }
  throw new Error("expected the work to fail");
}

describe("scope parity", () => {
  test("numeric values match Nest and legacy strings normalize", () => {
    expect(Scope.DEFAULT).toBe(0);
    expect(Scope.TRANSIENT).toBe(1);
    expect(Scope.REQUEST).toBe(2);

    const token = createToken<{ id: number }>("legacy.request");
    let created = 0;
    const provider = provideClass(
      token,
      class {
        readonly id = ++created;
      },
      [],
      { scope: "request" as ProviderScope },
    );
    expect(provider.scope).toBe(Scope.REQUEST);
  });

  test("a durable provider shares one instance under the strategy's parent id", () => {
    const token = createToken<{ readonly id: number }>("durable");
    let created = 0;
    class Durable {
      readonly id = ++created;
    }
    const feature = defineModule({
      id: "durable-feature",
      providers: [provideClass(token, Durable, [], { scope: Scope.REQUEST, durable: true })],
    });
    const root = defineModule({ id: "durable-root", imports: [feature] });
    const container = createContainer(root);

    const parent: ContextId = { id: "tenant-a" };
    ContextIdFactory.apply({
      attach: () => ({ resolve: () => parent, payload: {} }),
    });
    try {
      const first = ContextIdFactory.getByRequest({});
      const second = ContextIdFactory.getByRequest({});
      const a = container.resolveModuleProvider(feature, token, first);
      const b = container.resolveModuleProvider(feature, token, second);
      expect(a).toBe(b);
    } finally {
      ContextIdFactory.reset();
    }
  });

  test("REQUEST resolves the active request and CONTEXT the active context", () => {
    const probe = createToken<{ readonly request: Request; readonly context: object }>("probe");
    const request = new Request("http://localhost/context");
    const context = { request };
    const feature = defineModule({
      id: "context-feature",
      providers: [
        provideFactory(probe, [REQUEST, CONTEXT], (resolvedRequest, resolvedContext) => ({
          request: resolvedRequest as Request,
          context: resolvedContext as object,
        })),
      ],
    });
    const container = createContainer(feature);
    const instance = container.resolveModuleProvider(feature, probe, context);

    expect(instance.request).toBe(request);
    expect(instance.context).toBe(context);
    expect(failureOf(() => container.get(REQUEST)).code).toBe("MISSING_REQUEST_CONTEXT");
  });
});

describe("ModuleRef parity", () => {
  test("get refuses a token outside the receiving module unless strict is false", () => {
    const hidden = createToken<string>("hidden");
    const inner = defineModule({
      id: "inner",
      providers: [provideValue(hidden, "inner")],
      exports: [hidden],
    });
    const sibling = defineModule({ id: "sibling" });
    const root = defineModule({ id: "root", imports: [inner, sibling] });
    const container = createContainer(root);
    const reference = container.resolveModuleProvider(sibling, ModuleRef);

    expect(failureOf(() => reference.get(hidden)).code).toBe("MISSING_PROVIDER");
    expect(reference.get(hidden, { strict: false })).toBe("inner");
  });

  test("resolve creates a fresh subtree and create bypasses the cache", () => {
    const token = createToken<{ readonly id: number }>("scoped");
    let created = 0;
    class Scoped {
      readonly id = ++created;
    }
    const feature = defineModule({
      id: "scoped-feature",
      providers: [provideClass(token, Scoped, [], { scope: Scope.REQUEST })],
    });
    const root = defineModule({ id: "scoped-root", imports: [feature] });
    const container = createContainer(root);
    const reference = container.resolveModuleProvider(feature, ModuleRef);

    expect(reference.resolve(token)).not.toBe(reference.resolve(token));
    const context = { id: "one" };
    expect(reference.resolve(token, context)).toBe(reference.resolve(token, context));

    expect(() => reference.create(token)).toThrow(
      expect.objectContaining({ code: "MISSING_REQUEST_CONTEXT" }),
    );
    expect(reference.create(token, context)).not.toBe(reference.create(token, context));
  });

  test("registerRequestByContextId makes REQUEST answer that request", () => {
    const root = defineModule({ id: "request-root" });
    const container = createContainer(root);
    const reference = container.resolveModuleProvider(root, ModuleRef);
    const request = new Request("http://localhost/registered");
    const contextId = ContextIdFactory.create();

    reference.registerRequestByContextId(request, contextId);
    expect(container.resolveModuleProvider(root, REQUEST, contextId)).toBe(request);
    expect(
      (request as unknown as Record<symbol, unknown>)[Symbol.for("aponia.request.context.id")],
    ).toBe(contextId);
  });
});

describe("Application enhancer tokens", () => {
  test("repeated APP_* registrations are accepted and kept in declaration order", () => {
    class FirstGuard implements CanActivate {
      canActivate(): boolean {
        return true;
      }
    }
    class SecondGuard implements CanActivate {
      canActivate(): boolean {
        return true;
      }
    }
    const feature: ModuleDefinition = defineModule({
      id: "app-tokens",
      providers: [
        provideClass(FirstGuard, []),
        provideClass(SecondGuard, []),
        provideValue(APP_GUARD, FirstGuard),
        provideValue(APP_GUARD, [SecondGuard]),
      ],
    });

    const container = createContainer(feature);
    expect(container.providersFor(feature, APP_GUARD)).toHaveLength(2);
    expect(failureOf(() => container.get(APP_GUARD)).code).toBe("MISSING_PROVIDER");
  });

  test("a repeated non-APP token is still refused", () => {
    const duplicate = createToken<number>("duplicate");
    const module = defineModule({
      id: "duplicate-module",
      providers: [provideValue(duplicate, 1), provideValue(duplicate, 2)],
    });

    expect(failureOf(() => createContainer(module)).code).toBe("DUPLICATE_PROVIDER");
  });
});

describe("context tokens", () => {
  test("INQUIRER answers the provider that asked for it", () => {
    const token = createToken<{ readonly inquirer: unknown }>("inquirer");
    const feature = defineModule({
      id: "inquirer-feature",
      providers: [
        provideFactory(token, [INQUIRER], (inquirer) => {
          const probe = { inquirer };
          return probe;
        }),
      ],
    });
    const container = createContainer(feature);
    const instance = container.get(token);
    expect(instance).toMatchObject({ inquirer: expect.anything() });
  });
});

describe("ContextIdFactory", () => {
  test("create makes object-unique ids and getByRequest reads one off the request", () => {
    const first = ContextIdFactory.create();
    const second = ContextIdFactory.create();
    expect(first).not.toBe(second);

    const request = { raw: {} } as Record<string, unknown>;
    const attached = ContextIdFactory.create();
    (request.raw as Record<symbol, unknown>)[Symbol.for("aponia.request.context.id")] = attached;
    expect(ContextIdFactory.getByRequest(request)).toBe(attached);

    const direct = ContextIdFactory.create();
    (request as Record<symbol, unknown>)[Symbol.for("aponia.request.context.id")] = direct;
    expect(ContextIdFactory.getByRequest(request)).toBe(direct);
    expect(ContextIdFactory.getByRequest(undefined as never)).toBeDefined();
  });
});

describe("ModuleRef each", () => {
  test("each returns one instance per declaring module", () => {
    const token = createToken<string>("each");
    const first = defineModule({ id: "each-first", providers: [provideValue(token, "first")] });
    const second = defineModule({
      id: "each-second",
      providers: [provideValue(token, "second")],
    });
    const root = defineModule({ id: "each-root", imports: [first, second] });
    const container = createContainer(root);
    const reference = container.resolveModuleProvider(root, ModuleRef);

    expect(reference.get(token, { each: true }) as unknown as readonly string[]).toEqual([
      "first",
      "second",
    ]);
  });
});
