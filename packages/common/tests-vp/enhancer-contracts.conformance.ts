import {
  type AponiaInterceptor,
  type ArgumentsHost,
  type CanActivate,
  type ClassToken,
  type ExceptionFilter,
  type ExecutionContext,
  type HttpArgumentsHost,
  type RequestMethod,
  type RouteContext,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The published shape, pinned member by member. A host that grows a member, an
 * accessor that changes its return, or a filter that narrows `unknown` all fail
 * `bun run check`, which is this type-only contract's evidence.
 */
type EnhancerContractAssertions = [
  Expect<Equals<ExecutionContext extends ArgumentsHost ? true : false, true>>,
  Expect<Equals<keyof ArgumentsHost, "getContext" | "switchToHttp">>,
  Expect<
    Equals<
      keyof ExecutionContext,
      "getClass" | "getHandler" | "getRoute" | "getContext" | "switchToHttp"
    >
  >,
  Expect<Equals<keyof HttpArgumentsHost, "getRequest">>,
  Expect<Equals<ReturnType<ArgumentsHost["getContext"]>, RouteContext>>,
  Expect<Equals<ReturnType<ArgumentsHost["switchToHttp"]>, HttpArgumentsHost>>,
  Expect<Equals<ReturnType<HttpArgumentsHost["getRequest"]>, RouteContext>>,
  Expect<Equals<ReturnType<ExecutionContext["getClass"]>, ClassToken<unknown>>>,
  Expect<Equals<ReturnType<ExecutionContext["getHandler"]>, (...arguments_: never[]) => unknown>>,
  Expect<Equals<ReturnType<ExecutionContext["getRoute"]>["method"], RequestMethod>>,
  Expect<Equals<ReturnType<ExecutionContext["getRoute"]>["path"], string>>,
  Expect<Equals<Parameters<CanActivate["canActivate"]>[0], ExecutionContext>>,
  Expect<Equals<ReturnType<CanActivate["canActivate"]>, boolean | Promise<boolean>>>,
  Expect<
    Equals<
      NonNullable<AponiaInterceptor["interceptBefore"]>,
      (context: ExecutionContext) => void | Promise<void>
    >
  >,
  // `unknown` already contains a promise, so the return type states the awaited
  // case in its JSDoc instead of through a redundant union constituent. That an
  // asynchronous implementation is accepted is proven by the classes below.
  Expect<
    Equals<
      NonNullable<AponiaInterceptor["interceptAfter"]>,
      (context: ExecutionContext, response: unknown) => unknown
    >
  >,
  Expect<Equals<Parameters<ExceptionFilter["catch"]>[0], unknown>>,
  Expect<Equals<Parameters<ExceptionFilter["catch"]>[1], ArgumentsHost>>,
  Expect<Equals<ReturnType<ExceptionFilter["catch"]>, unknown>>,
];

/**
 * The route context the hosts below hand out, built from the published contract
 * alone: no platform type and no cast.
 */
const conformanceRequest: RouteContext = {
  body: undefined,
  cookie: {},
  headers: {},
  params: {},
  path: "/enhancer-conformance",
  query: {},
  request: new Request("http://localhost/enhancer-conformance"),
  set: { headers: {} },
};

const conformanceHttpHost: HttpArgumentsHost = {
  getRequest: () => conformanceRequest,
};

const conformanceArgumentsHost: ArgumentsHost = {
  getContext: () => conformanceRequest,
  switchToHttp: () => conformanceHttpHost,
};

/**
 * The host a guard and an interceptor are given. `getClass` throws because no
 * case here reads the controller class: a stub that returned one would have to
 * assert the caller's own type parameter.
 */
const conformanceExecutionContext: ExecutionContext = {
  ...conformanceArgumentsHost,
  getClass: () => {
    throw new Error("The enhancer conformance cases do not read the controller class.");
  },
  getHandler: () => () => undefined,
  getRoute: () => ({ method: "GET", path: "/enhancer-conformance" }),
};

class ExampleGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

class AsyncExampleGuard implements CanActivate {
  async canActivate(_context: ExecutionContext): Promise<boolean> {
    return true;
  }
}

class ExampleInterceptor implements AponiaInterceptor {
  interceptBefore(_context: ExecutionContext): void {}

  interceptAfter(_context: ExecutionContext, response: unknown): unknown {
    return response;
  }
}

class AsyncExampleInterceptor implements AponiaInterceptor {
  async interceptBefore(_context: ExecutionContext): Promise<void> {}

  async interceptAfter(_context: ExecutionContext, response: unknown): Promise<unknown> {
    return response;
  }
}

class ExampleFilter implements ExceptionFilter {
  catch(_exception: unknown, _host: ArgumentsHost): unknown {
    return undefined;
  }
}

class AsyncExampleFilter implements ExceptionFilter {
  async catch(_exception: unknown, _host: ArgumentsHost): Promise<unknown> {
    return undefined;
  }
}

test("the Vite+ lane accepts a synchronous and an asynchronous guard", async () => {
  const guards: readonly CanActivate[] = [new ExampleGuard(), new AsyncExampleGuard()];

  expect(guards).toHaveLength(2);
  expect(guards[0]?.canActivate(conformanceExecutionContext)).toBe(true);
  expect(await guards[1]?.canActivate(conformanceExecutionContext)).toBe(true);
});

test("the Vite+ lane accepts an interceptor declaring either half alone", async () => {
  const onlyBefore: AponiaInterceptor = { interceptBefore: () => undefined };
  const onlyAfter: AponiaInterceptor = { interceptAfter: (_c, response) => response };
  const interceptor = new ExampleInterceptor();
  const asyncInterceptor = new AsyncExampleInterceptor();

  expect([onlyBefore, onlyAfter]).toHaveLength(2);
  expect(onlyBefore.interceptBefore?.(conformanceExecutionContext)).toBeUndefined();
  expect(onlyAfter.interceptAfter?.(conformanceExecutionContext, "kept")).toBe("kept");
  expect(interceptor.interceptBefore(conformanceExecutionContext)).toBeUndefined();
  expect(interceptor.interceptAfter(conformanceExecutionContext, "handled")).toBe("handled");
  await asyncInterceptor.interceptBefore(conformanceExecutionContext);
  expect(await asyncInterceptor.interceptAfter(conformanceExecutionContext, "awaited")).toBe(
    "awaited",
  );
});

test("the Vite+ lane accepts a filter taking an arguments host", async () => {
  const filters: readonly ExceptionFilter[] = [new ExampleFilter(), new AsyncExampleFilter()];
  const exception = new Error("conformance failure");

  expect(filters).toHaveLength(2);
  expect(conformanceArgumentsHost.switchToHttp().getRequest().path).toBe("/enhancer-conformance");
  expect(conformanceArgumentsHost.getContext()).toBe(conformanceRequest);
  expect(filters[0]?.catch(exception, conformanceArgumentsHost)).toBeUndefined();
  expect(await filters[1]?.catch(exception, conformanceArgumentsHost)).toBeUndefined();
});

test("the Vite+ lane keeps the enhancer contract assertions referenced", () => {
  const assertions = Array.from({ length: 18 }, () => true) as EnhancerContractAssertions;

  expect(assertions).toHaveLength(18);
  expect(conformanceExecutionContext.getHandler()).toBeTypeOf("function");
  expect(conformanceExecutionContext.getRoute()).toEqual({
    method: "GET",
    path: "/enhancer-conformance",
  });
});
