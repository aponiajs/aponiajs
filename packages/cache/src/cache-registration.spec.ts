import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import type { ExecutionContext } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import {
  CacheInterceptor,
  CacheKey,
  CacheModule,
  CacheService,
  CacheTTL,
  MODULE_OPTIONS_TOKEN,
  MemoryCacheStore,
} from "./index.ts";

describe("CacheModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = CacheModule.forRoot({ keyPrefix: "app:" });

    expect(pluginRegistrationIssues(CacheModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, CacheModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("CacheModule");
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        CacheModule.forRoot({ keyPrefix: "first:" }),
        CacheModule.forRoot({ keyPrefix: "second:" }),
        CacheModule,
      ),
    ).toEqual([]);
  });

  test("the register alias answers the same definition shape as forRoot", () => {
    const definition = CacheModule.register({ keyPrefix: "alias:" });

    expect(dynamicModuleIssues(definition, CacheModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
  });

  test("isGlobal defaults to false and reaches the definition when stated", () => {
    expect(CacheModule.forRoot().global).toBe(false);
    expect(CacheModule.forRoot({ isGlobal: true }).global).toBe(true);
    expect(CacheModule.forRoot({ isGlobal: false }).global).toBe(false);
  });

  test("refuses a non-boolean isGlobal", () => {
    const error = capture(() => CacheModule.forRoot({ isGlobal: "yes" as never }));

    expect(error.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(error.details).toEqual({
      configuration: "cache",
      issues: Object.freeze(["isGlobal must be a boolean"]),
    });
  });

  test("refuses invalid options at registration, naming every issue", () => {
    const error = capture(() => CacheModule.forRoot({ ttlMs: 0, maxEntries: 0 }));

    expect(error.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(error.details.issues).toEqual([
      "ttlMs must be a positive finite number",
      "maxEntries must be a positive integer",
    ]);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        CacheModule.forRootAsync.bind(CacheModule),
        CacheModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("refuses an asynchronous registration with no factory arm", () => {
    expect(() => CacheModule.forRootAsync({} as never)).toThrow(AponiaError);
  });
});

describe("CacheModule decorators and interceptor", () => {
  test("records a key and a lifetime per handler", () => {
    class Controller {
      @CacheKey("users")
      @CacheTTL(1_000)
      list(): string {
        return "users";
      }
    }

    const handler = Object.getOwnPropertyDescriptor(Controller.prototype, "list")
      ?.value as unknown as object;
    const interceptor = new CacheInterceptor(
      new CacheService(new MemoryCacheStore(), resolvedOptions()),
    );

    expect(interceptor).toBeInstanceOf(CacheInterceptor);
    expect(Reflect.getOwnMetadata(Symbol.for("aponia.cache.key.metadata"), handler)).toBe("users");
    expect(Reflect.getOwnMetadata(Symbol.for("aponia.cache.ttl.metadata"), handler)).toBe(1_000);
  });

  test("refuses an empty key and a non-positive lifetime at the decoration site", () => {
    expect(() => CacheKey("")).toThrow(TypeError);
    expect(() => CacheTTL(0)).toThrow(TypeError);
    expect(() => CacheTTL(-1)).toThrow(TypeError);
  });

  test("writes a GET response under the declared key and nothing else", async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, resolvedOptions());
    const interceptor = new CacheInterceptor(cache);

    const get = routeContext("GET");
    expect(await interceptor.interceptAfter(get, "value")).toBe("value");
    expect(await cache.get("GET /users")).toBe("value");

    const post = routeContext("POST");
    await interceptor.interceptAfter(post, "created");
    expect(await cache.get("POST /users")).toBeUndefined();

    expect(await interceptor.interceptAfter(get, undefined)).toBeUndefined();
  });
});

function resolvedOptions(): {
  readonly ttlMs: number | undefined;
  readonly maxEntries: number;
  readonly keyPrefix: string;
} {
  return Object.freeze({ ttlMs: undefined, maxEntries: 10, keyPrefix: "" });
}

function routeContext(method: string): ExecutionContext {
  return {
    getRoute: () => ({ method, path: "/users" }),
    getHandler: () => () => "handler",
    switchToHttp: () => ({
      getRequest: () => ({ request: { url: "/users" } }),
    }),
  } as unknown as ExecutionContext;
}

function capture(run: () => unknown): AponiaError {
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
