import { expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Inject,
  Module,
  provideValue,
  type AponiaErrorCode,
} from "@aponiajs/common";
import {
  compileRootModule,
  getApplicationDiagnostics,
  type AponiaApplicationDiagnostics,
} from "@aponiajs/platform-elysia";
import type { AnyElysia } from "elysia";
import { createTestApplication } from "../src/index.ts";
import {
  ABSENT_GREETER,
  GreetingService,
  LoudGreetingService,
  PRIMARY_GREETER,
  SECONDARY_GREETER,
  type Greeter,
} from "./fixtures.ts";

@Controller("greetings")
class GreetingsController {
  constructor(private readonly greeter: GreetingService) {}

  @Get()
  read(): string {
    return this.greeter.greet("Ada");
  }
}

@Controller("token-greetings")
class TokenGreetingsController {
  constructor(@Inject(PRIMARY_GREETER) private readonly greeter: Greeter) {}

  @Get()
  read(): string {
    return this.greeter.greet("Ada");
  }
}

/** A root whose own module declares both the service and the controller. */
function ownModuleRoot() {
  @Module({ controllers: [GreetingsController], providers: [GreetingService] })
  class Root {}
  return Root;
}

/** A root that reaches the service through an import, so the override has to. */
function importedModuleRoot() {
  @Module({ providers: [GreetingService], exports: [GreetingService] })
  class FeatureModule {}

  @Module({ imports: [FeatureModule], controllers: [GreetingsController] })
  class Root {}
  return Root;
}

/** A root that provides one token the controller reads and one it can alias to. */
function tokenModuleRoot() {
  @Module({
    controllers: [TokenGreetingsController],
    providers: [
      provideValue(PRIMARY_GREETER, { greet: (name: string) => `primary ${name}` }),
      provideValue(SECONDARY_GREETER, { greet: (name: string) => `secondary ${name}` }),
    ],
  })
  class Root {}
  return Root;
}

/** A root where one module is imported along two paths, forming a diamond. */
function diamondModuleRoot() {
  @Module({ providers: [GreetingService], exports: [GreetingService] })
  class SharedModule {}

  @Module({ imports: [SharedModule], exports: [GreetingService] })
  class LeftModule {}

  @Module({ imports: [SharedModule], exports: [GreetingService] })
  class RightModule {}

  @Module({ imports: [LeftModule, RightModule], controllers: [GreetingsController] })
  class Root {}
  return Root;
}

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

/** Reads the boot record, refusing to let an absent one pass as an assertion. */
function diagnosticsOf(application: AnyElysia): AponiaApplicationDiagnostics {
  const diagnostics = getApplicationDiagnostics(application);
  if (!diagnostics) {
    throw new Error("the boot published no diagnostics record");
  }
  return diagnostics;
}

/** Reads a route's answer, so every case asserts on what a request received. */
async function readGreeting(application: {
  handle(request: Request): Response | Promise<Response>;
}): Promise<string> {
  const response = await application.handle(new Request("http://localhost/greetings"));
  expect(response.status).toBe(200);
  return response.text();
}

async function readTokenGreeting(application: {
  handle(request: Request): Response | Promise<Response>;
}): Promise<string> {
  const response = await application.handle(new Request("http://localhost/token-greetings"));
  expect(response.status).toBe(200);
  return response.text();
}

test("replaces a provider the root module itself declares", async () => {
  const application = await createTestApplication(ownModuleRoot())
    .overrideProvider(GreetingService)
    .useValue({ greet: (name: string) => `Stubbed for ${name}` })
    .compile();

  try {
    // The assertion is on what a request receives, so a substitute that reached
    // the container but not the controller injecting it cannot pass.
    expect(await readGreeting(application)).toBe("Stubbed for Ada");
  } finally {
    await application.close();
  }
});

test("replaces a provider an imported module exports", async () => {
  const application = await createTestApplication(importedModuleRoot())
    .overrideProvider(GreetingService)
    .useValue(new LoudGreetingService())
    .compile();

  try {
    expect(await readGreeting(application)).toBe("HELLO, Ada!");
  } finally {
    await application.close();
  }
});

test("replaces a provider reached through one of two paths to the same module", async () => {
  const application = await createTestApplication(diamondModuleRoot())
    .overrideProvider(GreetingService)
    .useValue(new LoudGreetingService())
    .compile();

  try {
    // The rewrite produces one copy of the shared module, so the graph compiler
    // still sees the one definition the diamond imported twice. Two copies would
    // share an identity and fail the boot with DUPLICATE_MODULE instead.
    expect(await readGreeting(application)).toBe("HELLO, Ada!");
  } finally {
    await application.close();
  }
});

test("refuses an override naming a token no module in the graph provides", async () => {
  const building = createTestApplication(ownModuleRoot())
    .overrideProvider(ABSENT_GREETER)
    .useValue({ greet: () => "never" });

  // A stub for a token the graph does not have would be a test that believes it
  // replaced a dependency and did not, so the build is refused rather than left
  // to pass against the real provider.
  try {
    await building.compile();
    throw new Error("the build should have been refused");
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    expect(codeOf(error)).toBe("MISSING_PROVIDER");
    expect((error as AponiaError).details).toEqual({ token: "absent-greeter" });
  }
});

test("gives each boot its own providers, leaving the module class untouched", async () => {
  const root = ownModuleRoot();
  const substitute = { greet: (name: string) => `Substitute for ${name}` };
  const overridden = await createTestApplication(root)
    .overrideProvider(GreetingService)
    .useValue(substitute)
    .compile();
  const plain = await createTestApplication(root).compile();

  try {
    // One module class, two boots: the override reached one container only.
    expect(await readGreeting(overridden)).toBe("Substitute for Ada");
    expect(await readGreeting(plain)).toBe("Hello, Ada!");
    expect(overridden.get(GreetingService)).toBe(substitute);
    expect(plain.get(GreetingService)).toBeInstanceOf(GreetingService);
    expect(plain.get(GreetingService)).not.toBe(substitute);
  } finally {
    await overridden.close();
    await plain.close();
  }
});

test("replaces a provider with a factory that resolves the dependencies it names", async () => {
  const application = await createTestApplication(tokenModuleRoot())
    .overrideProvider(PRIMARY_GREETER)
    .useFactory(
      (secondary: Greeter) => ({ greet: (name: string) => `via ${secondary.greet(name)}` }),
      [SECONDARY_GREETER],
    )
    .compile();

  try {
    expect(await readTokenGreeting(application)).toBe("via secondary Ada");
  } finally {
    await application.close();
  }
});

test("replaces a provider with a factory that resolves nothing", async () => {
  const application = await createTestApplication(tokenModuleRoot())
    .overrideProvider(PRIMARY_GREETER)
    .useFactory(() => ({ greet: (name: string) => `factory ${name}` }))
    .compile();

  try {
    expect(await readTokenGreeting(application)).toBe("factory Ada");
  } finally {
    await application.close();
  }
});

test("replaces a provider with a class and with another token", async () => {
  const byClass = await createTestApplication(tokenModuleRoot())
    .overrideProvider(PRIMARY_GREETER)
    .useClass(LoudGreetingService)
    .compile();
  const byAlias = await createTestApplication(tokenModuleRoot())
    .overrideProvider(PRIMARY_GREETER)
    .useExisting(SECONDARY_GREETER)
    .compile();

  try {
    expect(await readTokenGreeting(byClass)).toBe("HELLO, Ada!");
    expect(await readTokenGreeting(byAlias)).toBe("secondary Ada");
  } finally {
    await byClass.close();
    await byAlias.close();
  }
});

test("lets the later of two declarations for one token win", async () => {
  const application = await createTestApplication(tokenModuleRoot())
    .overrideProvider(PRIMARY_GREETER)
    .useValue({ greet: () => "first" })
    .overrideProvider(PRIMARY_GREETER)
    .useValue({ greet: () => "second" })
    .compile();

  try {
    expect(await readTokenGreeting(application)).toBe("second");
  } finally {
    await application.close();
  }
});

test("accepts a descriptor root, rewriting the graph that was handed over", async () => {
  const application = await createTestApplication(compileRootModule(ownModuleRoot()))
    .overrideProvider(GreetingService)
    .useValue(new LoudGreetingService())
    .compile();

  try {
    expect(await readGreeting(application)).toBe("HELLO, Ada!");
    // A descriptor root names the graph itself, so the boot reports it as the
    // declared graph rather than lowering it from decorators.
    expect(diagnosticsOf(application.application.getNativeApplication()).graph).toBe("declared");
  } finally {
    await application.close();
  }
});
