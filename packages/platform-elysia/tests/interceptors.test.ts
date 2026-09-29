import { describe, expect, test } from "bun:test";
import {
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  UseFilters,
  UseGuards,
  UseInterceptors,
  defineModule,
  provideClass,
  type ClassToken,
  type ExecutionContext,
  type RequestMethod,
  type RouteContext,
} from "@aponiajs/common";
import { t } from "elysia";
import {
  AponiaFactory,
  defineElysiaControllerRoutes,
  type AponiaElysiaApplication,
  type AponiaInvokerArtifact,
  type AponiaRouteInvoker,
} from "../src/index.ts";

const order: string[] = [];

@Injectable()
class OuterInterceptor {
  interceptBefore(): void {
    order.push("outer:before");
  }

  interceptAfter(_context: unknown, response: unknown): unknown {
    order.push("outer:after");
    return `${String(response)}+outer`;
  }
}

@Injectable()
class InnerInterceptor {
  interceptBefore(): void {
    order.push("inner:before");
  }

  interceptAfter(_context: unknown, response: unknown): unknown {
    order.push("inner:after");
    return `${String(response)}+inner`;
  }
}

@Injectable()
class GlobalInterceptor {
  interceptBefore(): void {
    order.push("global:before");
  }

  interceptAfter(_context: unknown, response: unknown): unknown {
    order.push("global:after");
    return `${String(response)}+global`;
  }
}

/** Declares only the before half, so it contributes nothing to a route's after chain. */
@Injectable()
class TimingInterceptor {
  interceptBefore(): void {
    order.push("timing:before");
  }
}

@Injectable()
class PassThroughInterceptor {
  interceptAfter(_context: unknown, _response: unknown): unknown {
    order.push("pass-through:after");
    return undefined;
  }
}

/**
 * Both halves return a Promise, so a route running it is ordered by the awaited
 * halves rather than by whichever half happened to be scheduled first.
 */
@Injectable()
class AsyncWrappingInterceptor {
  async interceptBefore(): Promise<void> {
    order.push("async:before:start");
    await Promise.resolve();
    order.push("async:before:end");
  }

  async interceptAfter(_context: unknown, response: unknown): Promise<unknown> {
    order.push("async:after:start");
    await Promise.resolve();
    order.push("async:after:end");
    return `${String(response)}+async`;
  }
}

/**
 * Declared after the asynchronous interceptor, so its own before half runs
 * while that half's promise is still pending unless the compiled hook awaits.
 * It records what it saw rather than throwing, so a mutation that stops the
 * await changes the recorded order instead of answering a 500.
 */
@Injectable()
class BeforeOrderProbeInterceptor {
  interceptBefore(): void {
    order.push(order.includes("async:before:end") ? "probe:after-async" : "probe:before-async");
  }
}

@Injectable()
class InvokerWrappingInterceptor {
  interceptAfter(_context: unknown, response: unknown): unknown {
    return `${String(response)}+wrapped`;
  }
}

@Injectable()
class DeclaredWrappingInterceptor {
  interceptAfter(_context: unknown, response: unknown): unknown {
    return `${String(response)}+declared`;
  }
}

@Injectable()
class ThrowingGuard {
  canActivate(): boolean {
    throw new Error("guard exploded");
  }
}

@Injectable()
class AfterMustNotRun {
  interceptAfter(): unknown {
    order.push("after-ran");
    return undefined;
  }
}

class HandlerFailure extends Error {}

@Catch(HandlerFailure)
@Injectable()
class HandlerFailureFilter {
  catch(): unknown {
    return new Response("answered by the filter", { status: 503 });
  }
}

@Injectable()
class FailingAfterInterceptor {
  interceptBefore(): void {
    order.push("failing:before");
  }

  interceptAfter(): unknown {
    order.push("failing:after");
    return undefined;
  }
}

@Controller("wrapped")
@UseInterceptors(OuterInterceptor, InnerInterceptor)
class WrappedController {
  @Get()
  read(): string {
    order.push("handler");
    return "value";
  }
}

@Controller("passthrough")
@UseInterceptors(PassThroughInterceptor)
class PassThroughController {
  @Get()
  read(): string {
    return "value";
  }
}

@Controller("guarded")
@UseGuards(ThrowingGuard)
@UseInterceptors(AfterMustNotRun)
class GuardedController {
  @Get()
  read(): string {
    order.push("handler");
    return "value";
  }
}

@Controller("failing")
@UseFilters(HandlerFailureFilter)
@UseInterceptors(FailingAfterInterceptor)
class FailingController {
  @Get()
  read(): string {
    order.push("handler");
    throw new HandlerFailure("handler exploded");
  }
}

@Controller("timing")
@UseInterceptors(TimingInterceptor)
class TimingController {
  @Get()
  read(): string {
    order.push("handler");
    return "timing";
  }
}

// The asynchronous interceptor is declared after the outer one, so its after
// half runs first and the value it answers with is what the outer half reads.
@Controller("async-wrapped")
@UseInterceptors(OuterInterceptor, AsyncWrappingInterceptor, BeforeOrderProbeInterceptor)
class AsyncWrappedController {
  @Get()
  read(): string {
    order.push("handler");
    return "value";
  }
}

@Controller("scoped")
@UseInterceptors(OuterInterceptor, InnerInterceptor)
class ScopedController {
  @Get()
  @UseInterceptors(TimingInterceptor)
  read(): string {
    order.push("handler");
    return "scoped";
  }
}

@Controller("invoked")
@UseInterceptors(InvokerWrappingInterceptor)
class InvokedController {
  @Get()
  read(): string {
    order.push("handler");
    return "compiled";
  }
}

/**
 * What each accessor answered for the one request the probe interceptor ran for.
 *
 * The interceptor records the values itself, from the context the platform
 * handed a real request, so a case asserts what an interceptor is actually
 * given rather than what a context built in isolation would answer.
 */
interface InterceptorProbe {
  controller?: ClassToken<unknown>;
  handler?: (...arguments_: never[]) => unknown;
  route?: Readonly<{ readonly method: RequestMethod; readonly path: string }>;
  context?: RouteContext;
  request?: RouteContext;
  afterController?: ClassToken<unknown>;
  afterHandler?: (...arguments_: never[]) => unknown;
  afterRoute?: Readonly<{ readonly method: RequestMethod; readonly path: string }>;
  afterContext?: RouteContext;
  afterRequest?: RouteContext;
  afterResponse?: unknown;
}

const probe: InterceptorProbe = {};

@Injectable()
class ProbeInterceptor {
  interceptBefore(context: ExecutionContext): void {
    probe.controller = context.getClass<ProbeController>();
    probe.handler = context.getHandler();
    probe.route = context.getRoute();
    probe.context = context.getContext();
    probe.request = context.switchToHttp().getRequest();
  }

  interceptAfter(context: ExecutionContext, response: unknown): unknown {
    probe.afterController = context.getClass<ProbeController>();
    probe.afterHandler = context.getHandler();
    probe.afterRoute = context.getRoute();
    probe.afterContext = context.getContext();
    probe.afterRequest = context.switchToHttp().getRequest();
    probe.afterResponse = response;
    return undefined;
  }
}

@Controller("probe")
@UseInterceptors(ProbeInterceptor)
class ProbeController {
  @Get()
  // The handler never reads `this`, which the annotation states so that a case
  // can hold the method itself as the handler an interceptor is given.
  read(this: void): string {
    order.push("handler");
    return "probe";
  }
}

@Module({
  controllers: [
    WrappedController,
    PassThroughController,
    GuardedController,
    FailingController,
    TimingController,
    AsyncWrappedController,
    ScopedController,
    InvokedController,
    ProbeController,
  ],
  providers: [
    OuterInterceptor,
    InnerInterceptor,
    GlobalInterceptor,
    TimingInterceptor,
    PassThroughInterceptor,
    AsyncWrappingInterceptor,
    BeforeOrderProbeInterceptor,
    InvokerWrappingInterceptor,
    ThrowingGuard,
    AfterMustNotRun,
    HandlerFailureFilter,
    FailingAfterInterceptor,
    ProbeInterceptor,
  ],
})
class AppModule {}

@Injectable()
class SchemaAnswerInterceptor {
  interceptAfter(_context: unknown, response: unknown): unknown {
    return `${String(response)}+wrapped`;
  }
}

@Injectable()
class MismatchedAnswerInterceptor {
  interceptAfter(): unknown {
    return 42;
  }
}

@Controller("schema")
@UseInterceptors(SchemaAnswerInterceptor)
class SchemaController {
  @Get("wrapped", { response: t.String() })
  wrapped(): string {
    return "value";
  }
}

@Controller("mismatched")
@UseInterceptors(MismatchedAnswerInterceptor)
class MismatchedController {
  @Get("answer", { response: t.String() })
  answer(): string {
    return "value";
  }
}

@Module({
  controllers: [SchemaController, MismatchedController],
  providers: [SchemaAnswerInterceptor, MismatchedAnswerInterceptor],
})
class SchemaModule {}

/**
 * The hook object Elysia mounted for one path, which is what a boot compiled for
 * that route made observable.
 */
function mountedHooks(application: AponiaElysiaApplication, path: string): Record<string, unknown> {
  const route = application
    .getNativeApplication()
    .routes.find((candidate) => candidate.path === path);
  if (route === undefined) {
    throw new Error(`The application mounted no route at ${path}.`);
  }

  return (route.hooks ?? {}) as unknown as Record<string, unknown>;
}

/**
 * The version the running platform reports, read from the manifest it ships
 * rather than imported from the module under test, so an artifact a case
 * supplies is one the running platform accepts.
 */
const frameworkVersion = (
  (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { version: string }
).version;

/** An artifact shaped the way `aponia build` writes one, holding one controller. */
function invokerArtifact(
  invoker: (instance: InvokedController) => ReadonlyMap<string | symbol, AponiaRouteInvoker>,
): AponiaInvokerArtifact {
  return Object.freeze({
    framework: frameworkVersion,
    elysia: "1.4.30",
    invokers: new Map([[InvokedController, invoker]]),
  });
}

describe("interceptors", () => {
  test("before runs in declaration order and after runs in reverse, wrapping the response", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/wrapped"));

    expect([await response.text(), order]).toEqual([
      "value+inner+outer",
      ["outer:before", "inner:before", "handler", "inner:after", "outer:after"],
    ]);
    await application.close();
  });

  test("awaits an asynchronous half before its value is used", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/async-wrapped"));

    // The before half's awaited work finishes before the next before half runs,
    // and the after half's awaited value is what the interceptor behind it
    // receives: an unawaited half would leave the probe reading
    // `probe:before-async`, hand the outer interceptor a Promise, and put
    // `[object Promise]` in the body instead of the resolved string.
    expect([await response.text(), order]).toEqual([
      "value+async+outer",
      [
        "outer:before",
        "async:before:start",
        "async:before:end",
        "probe:after-async",
        "handler",
        "async:after:start",
        "async:after:end",
        "outer:after",
      ],
    ]);
    await application.close();
  });

  test("returning undefined from interceptAfter leaves the response unchanged", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/passthrough"));

    // The interceptor ran — a route that never called it would leave `order`
    // empty and answer the same body, which is why the call is asserted too.
    expect([await response.text(), order]).toEqual(["value", ["pass-through:after"]]);
    await application.close();
  });

  test("a guard that throws answers 500 and leaves every after half unrun", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/guarded"));

    expect(response.status).toBe(500);
    expect(order).toEqual([]);
    await application.close();
  });

  test("interceptAfter does not run when the handler throws, and the error reaches the filters", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/failing"));

    // The declared filter answered, so the thrown handler error reached the
    // route's own error path rather than the interceptor's after half.
    expect([response.status, await response.text()]).toEqual([503, "answered by the filter"]);
    expect(order).toEqual(["failing:before", "handler"]);
    await application.close();
  });

  test("global, controller, and method scopes run in that order and the after halves reverse the whole list", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, {
      logger: false,
      interceptors: [GlobalInterceptor],
    });

    const response = await application.handle(new Request("http://localhost/scoped"));

    expect([await response.text(), order]).toEqual([
      "scoped+inner+outer+global",
      [
        "global:before",
        "outer:before",
        "inner:before",
        "timing:before",
        "handler",
        "inner:after",
        "outer:after",
        "global:after",
      ],
    ]);
    await application.close();
  });

  test("an interceptor is given the route's execution context and the handler's result", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, { logger: false });

    const response = await application.handle(new Request("http://localhost/probe"));

    expect(await response.text()).toBe("probe");
    expect(probe.controller).toBe(ProbeController);
    // The handler is the controller's own method, not the platform's invoker, so
    // an interceptor recognises the route it wraps the way Nest code does.
    expect(probe.handler).toBe(ProbeController.prototype.read);
    expect(probe.route).toEqual({ method: "GET", path: "/probe" });
    // `switchToHttp().getRequest()` and `getContext()` are the same object, which
    // is the request the context describes.
    expect(probe.request).toBe(probe.context);
    expect(probe.context?.request.url).toBe("http://localhost/probe");
    expect(probe.context?.path).toBe("/probe");

    // The after half is given the same route and the same kind of context, and
    // the handler's own result rather than the platform's invoker or the
    // Response Elysia builds from it.
    expect(probe.afterController).toBe(ProbeController);
    expect(probe.afterHandler).toBe(ProbeController.prototype.read);
    expect(probe.afterRoute).toEqual({ method: "GET", path: "/probe" });
    expect(probe.afterRequest).toBe(probe.afterContext);
    expect(probe.afterContext?.request.url).toBe("http://localhost/probe");
    expect(probe.afterResponse).toBe("probe");

    await application.close();
  });

  test("an interceptor wraps a route served by a supplied invoker", async () => {
    order.length = 0;
    const application = await AponiaFactory.create(AppModule, {
      logger: false,
      invokers: invokerArtifact(
        (instance) => new Map([["read", () => `from-invoker:${instance.read()}`]]),
      ),
    });

    const response = await application.handle(new Request("http://localhost/invoked"));

    // Both halves are observable: the body says the supplied invoker answered,
    // and the suffix says the interceptor wrapped whatever it answered with.
    expect(await response.text()).toBe("from-invoker:compiled+wrapped");
    await application.close();
  });
});

describe("interceptors and the schema a route declares", () => {
  test("the answer an interceptor returns is the response the route's schema validates", async () => {
    const application = await AponiaFactory.create(SchemaModule, { logger: false });

    const wrapped = await application.handle(new Request("http://localhost/schema/wrapped"));
    expect([wrapped.status, await wrapped.text()]).toEqual([200, "value+wrapped"]);

    // A half that answers with a value the schema does not accept fails the way
    // a handler returning it would: an interceptor's answer is validated, never
    // trusted, and it is what the response carries either way.
    const mismatched = await application.handle(new Request("http://localhost/mismatched/answer"));
    expect(mismatched.status).toBe(500);

    await application.close();
  });
});

describe("the hooks a route with interceptors mounts", () => {
  test("a route carrying an interceptor and no guard mounts the interceptor's before half", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    // The route declares no guard, so a before hook it carries had to be
    // assembled from the interceptor alone. Without that, this route mounts no
    // hook at all and its interceptor never runs — the regression the gate this
    // task fixes would have produced the moment a route could carry one.
    expect(mountedHooks(application, "/timing").beforeHandle).toHaveLength(1);

    await application.close();
  });

  test("each half is mounted only for the interceptors that declare one", async () => {
    const application = await AponiaFactory.create(AppModule, { logger: false });

    // An interceptor that declares no before half leaves the route with no
    // `beforeHandle`, and one that declares no after half leaves it with no
    // `afterHandle`: the lifecycle a route gains is the one its interceptors
    // declare, so neither hook is ever mounted to run nothing.
    expect(mountedHooks(application, "/passthrough").beforeHandle).toBeUndefined();
    expect(mountedHooks(application, "/passthrough").afterHandle).toHaveLength(1);
    expect(mountedHooks(application, "/timing").afterHandle).toBeUndefined();
    expect(mountedHooks(application, "/wrapped").beforeHandle).toHaveLength(1);
    expect(mountedHooks(application, "/wrapped").afterHandle).toHaveLength(1);

    await application.close();
  });
});

describe("interceptors on the declared-descriptor path", () => {
  test("a plan's interceptor wraps the response of the route it declares", async () => {
    class DeclaredInterceptorController {
      read(): string {
        return "declared";
      }
    }

    const module = defineModule({
      id: "DeclaredInterceptorModule",
      providers: [provideClass(DeclaredWrappingInterceptor, [])],
      controllers: [
        defineElysiaControllerRoutes(DeclaredInterceptorController, {
          path: "declared",
          routes: [
            {
              method: "GET",
              path: "",
              propertyKey: "read",
              interceptors: [DeclaredWrappingInterceptor],
            },
          ],
        }),
      ],
    });
    const application = await AponiaFactory.create(module, { logger: false });

    const response = await application.handle(new Request("http://localhost/declared"));

    expect(await response.text()).toBe("declared+declared");
    await application.close();
  });
});
