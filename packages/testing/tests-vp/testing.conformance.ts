import {
  AponiaError,
  Controller,
  Get,
  Inject,
  Module,
  createToken,
  provideValue,
  type ModuleImport,
} from "@aponiajs/common";
import { AponiaFactory, getApplicationDiagnostics } from "@aponiajs/platform-elysia";
import { createTestApplication, Test, TestApplication } from "../src/index.ts";
import type { TestApplicationBuilder, TestProviderOverride } from "../src/index.ts";
import type { TestApplicationOptions, TestServer } from "../src/index.ts";
import type { AnyElysia, Elysia } from "elysia";
import type {
  AponiaApplication,
  AponiaApplicationDiagnostics,
  AponiaApplicationOptions,
} from "@aponiajs/platform-elysia";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

interface ConformanceGreeter {
  greet(name: string): string;
}

const CONFORMANCE_GREETER = createToken<ConformanceGreeter>("conformance-greeter");
const CONFORMANCE_ABSENT = createToken<ConformanceGreeter>("conformance-absent");

@Controller("greeting")
class ConformanceController {
  constructor(@Inject(CONFORMANCE_GREETER) private readonly greeter: ConformanceGreeter) {}

  @Get()
  read(): string {
    return this.greeter.greet("Ada");
  }
}

function conformanceRoot(): ModuleImport {
  @Module({
    controllers: [ConformanceController],
    providers: [provideValue(CONFORMANCE_GREETER, { greet: (name: string) => `Hello, ${name}!` })],
  })
  class ConformanceModule {}
  return ConformanceModule;
}

/**
 * The compile-time half of this lane: the contract a consumer writes against.
 *
 * `TestApplicationOptions` is the assertion that matters most. It is the
 * factory's own option contract rather than a narrower copy, so every option a
 * boot takes stays reachable from a test; a hand-written subset that stopped
 * matching the factory fails `bun run check` here instead of shipping.
 *
 * `configureNative` is the one option it must not carry, and the `Extract` below
 * is what holds that: the builder's native application is erased to `AnyElysia`,
 * so accepting the option would accept a type argument the wrapper discards. The
 * README states the limitation, and this assertion is what makes the sentence
 * false the moment the platform moves that option onto the base contract.
 */
type TestingContractAssertions = [
  Expect<Equals<TestApplicationOptions, AponiaApplicationOptions>>,
  Expect<Equals<Extract<keyof TestApplicationOptions, "configureNative">, never>>,
  Expect<Equals<Parameters<typeof createTestApplication>[0], ModuleImport>>,
  Expect<Equals<Parameters<typeof createTestApplication>[1], TestApplicationOptions | undefined>>,
  Expect<Equals<ReturnType<typeof createTestApplication>, TestApplicationBuilder>>,
  Expect<Equals<ReturnType<TestApplicationBuilder["compile"]>, Promise<TestApplication>>>,
  Expect<
    Equals<ReturnType<TestProviderOverride<ConformanceGreeter>["useValue"]>, TestApplicationBuilder>
  >,
  Expect<
    Equals<
      ReturnType<TestProviderOverride<ConformanceGreeter>["useExisting"]>,
      TestApplicationBuilder
    >
  >,
  Expect<Equals<TestApplication["application"], AponiaApplication<AnyElysia>>>,
  Expect<Equals<TestApplication["get"], <T>(token: import("@aponiajs/common").Token<T>) => T>>,
  Expect<Equals<TestApplication["handle"], (request: Request) => Response | Promise<Response>>>,
  Expect<Equals<ReturnType<TestApplication["listen"]>, Promise<TestServer>>>,
  Expect<Equals<TestApplication["close"], () => Promise<void>>>,
  Expect<Equals<TestApplication[typeof Symbol.asyncDispose], () => Promise<void>>>,
  Expect<Equals<TestServer["url"], string>>,
  Expect<Equals<TestServer["webSocketUrl"], string>>,
];

/** The barrel as a consumer's `import` sees it. */
type TestingBarrel = typeof import("../src/index.ts");

/** The value exports this package must keep, named so a dropped one fails here. */
type TestingBarrelAssertions = [
  Expect<
    Equals<
      Extract<keyof TestingBarrel, "createTestApplication" | "TestApplication" | "Test">,
      "createTestApplication" | "TestApplication" | "Test"
    >
  >,
];

const assertion: TestingContractAssertions = Array.from(
  { length: 16 },
  () => true,
) as TestingContractAssertions;

function codeOf(error: unknown): string | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

/** Reads the boot record, refusing to let an absent one pass as an assertion. */
function diagnosticsOf(application: Elysia): AponiaApplicationDiagnostics {
  const diagnostics = getApplicationDiagnostics(application);
  if (!diagnostics) {
    throw new Error("the boot published no diagnostics record");
  }
  return diagnostics;
}

test("keeps the contract assertions referenced", () => {
  expect(assertion).toHaveLength(16);
});

test("reaches a route through handle with no socket bound", async () => {
  const application = await createTestApplication(conformanceRoot())
    .overrideProvider(CONFORMANCE_GREETER)
    .useValue({ greet: (name: string) => `Stubbed for ${name}` })
    .compile();

  try {
    const response = await application.handle(new Request("http://localhost/greeting"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Stubbed for Ada");
  } finally {
    await application.close();
  }
});

test("refuses an override naming a token no module provides", async () => {
  let failure: unknown;

  try {
    await createTestApplication(conformanceRoot())
      .overrideProvider(CONFORMANCE_ABSENT)
      .useValue({ greet: () => "never" })
      .compile();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect(codeOf(failure)).toBe("MISSING_PROVIDER");
  expect((failure as AponiaError).details).toEqual({ token: "conformance-absent" });
});

test("boots as the factory does when nothing is overridden, and closes twice", async () => {
  const root = conformanceRoot();
  const tested = await createTestApplication(root).compile();
  const plain = await AponiaFactory.create(root, { logger: false });

  try {
    const testedDiagnostics = diagnosticsOf(tested.application.getNativeApplication());
    const plainDiagnostics = diagnosticsOf(plain.getNativeApplication());

    expect(testedDiagnostics.graph).toBe("decorated");
    expect(testedDiagnostics.graph).toBe(plainDiagnostics.graph);
    expect(testedDiagnostics.rootModule.id).toBe(plainDiagnostics.rootModule.id);

    const request = (): Request => new Request("http://localhost/greeting");
    expect(await (await tested.handle(request())).text()).toBe(
      await (await plain.handle(request())).text(),
    );
  } finally {
    await tested.close();
    await tested.close();
    await plain.close();
  }

  const assertions: TestingBarrelAssertions = [true];
  expect(assertions).toHaveLength(1);
});

test("the Vite+ lane creates testing module and resolves providers with overrides", async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConformanceController],
    providers: [provideValue(CONFORMANCE_GREETER, { greet: () => "conformance-real" })],
  })
    .overrideProvider(CONFORMANCE_GREETER)
    .useValue({ greet: (name: string) => `conformance-mock-${name}` })
    .compile();

  const greeter = moduleRef.get(CONFORMANCE_GREETER);
  expect(greeter.greet("VitePlus")).toBe("conformance-mock-VitePlus");

  const app = await moduleRef.createAponiaApplication();
  const res = await app.handle(new Request("http://localhost/greeting"));
  expect(await res.text()).toBe("conformance-mock-Ada");

  await moduleRef.close();
});
