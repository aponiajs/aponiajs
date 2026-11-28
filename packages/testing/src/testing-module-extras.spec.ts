import { expect, test } from "bun:test";
import {
  APP_GUARD,
  Module,
  Scope,
  createToken,
  forwardRef,
  provideClass,
  provideFactory,
  provideValue,
  type CanActivate,
} from "@aponiajs/common";
import { Test } from "./index.ts";

/**
 * The Nest-shaped builder's less-travelled paths: the four enhancer override
 * names delegate to the provider rewrite, an override applied to a module is
 * either a value or a factory, a mocker walks a diamond and skips what is
 * already spoken for, and teardown is total. Each case compiles a real testing
 * module and reads the result back through it.
 */

const ROOT_VALUE = createToken<string>("extras.root");
const LEFT_VALUE = createToken<string>("extras.left");
const RIGHT_VALUE = createToken<string>("extras.right");
const SHARED_VALUE = createToken<string>("extras.shared");

@Module({ providers: [provideValue(SHARED_VALUE, "shared")], exports: [SHARED_VALUE] })
class SharedModule {}

const FORWARD_VALUE = createToken<string>("extras.forward");

@Module({ providers: [provideValue(FORWARD_VALUE, "forward")], exports: [FORWARD_VALUE] })
class ForwardModule {}

@Module({
  imports: [SharedModule],
  providers: [provideValue(LEFT_VALUE, "left")],
  exports: [LEFT_VALUE, SHARED_VALUE],
})
class LeftModule {}

@Module({
  imports: [SharedModule],
  providers: [provideValue(RIGHT_VALUE, "right")],
  exports: [RIGHT_VALUE, SHARED_VALUE],
})
class RightModule {}

@Module({
  imports: [LeftModule, RightModule, forwardRef(() => ForwardModule)],
  providers: [provideValue(ROOT_VALUE, "root")],
  exports: [ROOT_VALUE, LEFT_VALUE, RIGHT_VALUE, SHARED_VALUE],
})
class DiamondModule {}

class AllowingGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

test("overrideModule walks past a forward reference", async () => {
  const replacement = createToken<string>("extras.forward-replacement");

  @Module({ providers: [provideValue(replacement, "original")], exports: [replacement] })
  class OriginalModule {}

  @Module({ providers: [provideValue(replacement, "replaced")], exports: [replacement] })
  class ReplacementModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [OriginalModule, forwardRef(() => ForwardModule)],
  })
    .overrideModule(OriginalModule)
    .useValue(ReplacementModule)
    .compile();

  expect(moduleRef.get(replacement)).toBe("replaced");
  await moduleRef.close();
});

test("a provider override behind a forward reference still reaches the provider", async () => {
  const deferred = createToken<string>("extras.deferred");

  @Module({ providers: [provideValue(deferred, "real")], exports: [deferred] })
  class DeferredModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [forwardRef(() => DeferredModule)],
  })
    .overrideProvider(deferred)
    .useValue("mocked")
    .compile();

  expect(moduleRef.get(deferred)).toBe("mocked");
  await moduleRef.close();
});

test("the four enhancer override names all delegate to the provider rewrite", async () => {
  const interceptor = createToken<object>("extras.interceptor");
  const filter = createToken<object>("extras.filter");
  const pipe = createToken<object>("extras.pipe");
  const guard = createToken<object>("extras.guard");

  const moduleRef = await Test.createTestingModule({
    providers: [
      provideClass(guard, AllowingGuard, []),
      provideClass(interceptor, class {}, []),
      provideClass(filter, class {}, []),
      provideClass(pipe, class {}, []),
    ],
  })
    .overrideGuard(guard)
    .useValue({ kind: "guard" })
    .overrideInterceptor(interceptor)
    .useValue({ kind: "interceptor" })
    .overrideFilter(filter)
    .useValue({ kind: "filter" })
    .overridePipe(pipe)
    .useValue({ kind: "pipe" })
    .compile();

  expect(moduleRef.get(guard)).toEqual({ kind: "guard" });
  expect(moduleRef.get(interceptor)).toEqual({ kind: "interceptor" });
  expect(moduleRef.get(filter)).toEqual({ kind: "filter" });
  expect(moduleRef.get(pipe)).toEqual({ kind: "pipe" });
  await moduleRef.close();
});

test("overrideModule accepts a factory that answers the replacement module", async () => {
  @Module({ providers: [provideValue(SHARED_VALUE, "original")], exports: [SHARED_VALUE] })
  class OriginalModule {}

  @Module({ providers: [provideValue(SHARED_VALUE, "replacement")], exports: [SHARED_VALUE] })
  class ReplacementModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [OriginalModule],
  })
    .overrideModule(OriginalModule)
    .useFactory(() => ReplacementModule)
    .compile();

  expect(moduleRef.get(SHARED_VALUE)).toBe("replacement");
  await moduleRef.close();
});

test("a mocker walks a diamond once, skips an explicit override and an APP_* token", async () => {
  const mocked: unknown[] = [];
  const moduleRef = await Test.createTestingModule(DiamondModule)
    .overrideProvider(ROOT_VALUE)
    .useValue("explicit")
    .useMocker((token) => {
      mocked.push(token);
      return token === LEFT_VALUE ? "mocked-left" : undefined;
    })
    .compile();

  expect(moduleRef.get(ROOT_VALUE)).toBe("explicit");
  expect(moduleRef.get(LEFT_VALUE)).toBe("mocked-left");
  expect(moduleRef.get(RIGHT_VALUE)).toBe("right");
  expect(moduleRef.get(SHARED_VALUE)).toBe("shared");
  // A diamond reaches the shared module twice; the walk stops the second time.
  expect(mocked.filter((token) => token === SHARED_VALUE)).toHaveLength(1);
  // A `forwardRef` import is left untouched, so its provider is never mocked.
  expect(mocked).not.toContain(FORWARD_VALUE);
  await moduleRef.close();
});

test("a mocker leaves an application-enhancer token alone", async () => {
  const seen: unknown[] = [];
  const moduleRef = await Test.createTestingModule({
    providers: [provideClass(APP_GUARD, AllowingGuard, [])],
  })
    .useMocker((token) => {
      seen.push(token);
      return undefined;
    })
    .compile();

  expect(seen).not.toContain(APP_GUARD);
  await moduleRef.close();
});

test("get and resolve rethrow a failure the provider itself raised", async () => {
  const failing = createToken<string>("extras.failing");
  const moduleRef = await Test.createTestingModule({
    providers: [
      provideFactory(
        failing,
        [],
        () => {
          throw new Error("factory failed");
        },
        { scope: Scope.TRANSIENT },
      ),
    ],
  }).compile();

  expect(() => moduleRef.get(failing)).toThrow("factory failed");
  let rejected: unknown;
  try {
    await moduleRef.resolve(failing);
  } catch (error) {
    rejected = error;
  }
  expect((rejected as Error).message).toBe("factory failed");
  await moduleRef.close();
});

test("get refuses to construct a request-scoped provider outside a context", async () => {
  const scoped = createToken<object>("extras.scoped");
  const moduleRef = await Test.createTestingModule({
    providers: [provideClass(scoped, class Scoped {}, [], { scope: Scope.REQUEST })],
  }).compile();

  expect(() => moduleRef.get(scoped)).toThrow();
  await moduleRef.close();
});

test("close skips enhancer tokens and survives a teardown that throws", async () => {
  const fragile = createToken<object>("extras.fragile");
  const moduleRef = await Test.createTestingModule({
    providers: [
      provideClass(APP_GUARD, AllowingGuard, []),
      provideValue(fragile, {
        onModuleDestroy() {
          throw new Error("teardown refused");
        },
      }),
    ],
  }).compile();

  await moduleRef.close();
  await moduleRef.close();
});
