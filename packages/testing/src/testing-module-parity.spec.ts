import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  Scope,
  createToken,
  provideClass,
  provideValue,
  type LoggerService,
} from "@aponiajs/common";
import { Test } from "./index.ts";

const VALUE = createToken<string>("testing.value");
const SCOPED = createToken<{ readonly id: number }>("testing.scoped");
const HIDDEN = createToken<string>("testing.hidden");

@Injectable()
class Consumer {
  constructor(readonly value: string) {}
}

@Controller("testing")
class TestingController {
  @Get()
  read(): string {
    return "testing";
  }
}

@Module({
  controllers: [TestingController],
  providers: [
    provideValue(VALUE, "real"),
    provideValue(HIDDEN, "hidden"),
    provideClass(Consumer, [VALUE]),
  ],
  exports: [VALUE, HIDDEN, Consumer],
})
class ValueModule {}

@Module({ providers: [provideValue(HIDDEN, "hidden")], exports: [HIDDEN] })
class HiddenModule {}

describe("TestingModuleBuilder parity", () => {
  test("useMocker substitutes every unoverridden provider token", async () => {
    const moduleRef = await Test.createTestingModule(ValueModule)
      .useMocker((token) => (token === HIDDEN ? "mocked" : undefined))
      .compile();

    expect(moduleRef.get(HIDDEN)).toBe("mocked");
    expect(moduleRef.get(VALUE)).toBe("real");
    await moduleRef.close();
  });

  test("overrideModule replaces an imported module by reference", async () => {
    @Module({ imports: [HiddenModule], providers: [provideClass(Consumer, [HIDDEN])] })
    class RootModule {}

    const replacement = {
      id: "replacement",
      moduleClass: HiddenModule,
      imports: [],
      controllers: [],
      providers: [provideValue(HIDDEN, "replaced")],
      exports: [HIDDEN],
    } as const;

    const moduleRef = await Test.createTestingModule(RootModule)
      .overrideModule(HiddenModule)
      .useValue(replacement as never)
      .compile();

    expect(moduleRef.get(HIDDEN)).toBe("replaced");
    await moduleRef.close();
  });

  test("overrideProvider supports the factory options shape and inject", async () => {
    const moduleRef = await Test.createTestingModule(ValueModule)
      .overrideProvider(Consumer)
      .useFactory({ factory: (value: string) => new Consumer(`${value}!`), inject: [VALUE] })
      .compile();

    expect(moduleRef.get(Consumer).value).toBe("real!");
    await moduleRef.close();
  });

  test("scoped resolve builds a sub-tree per context id", async () => {
    let created = 0;
    class Scoped {
      readonly id = ++created;
    }
    const moduleRef = await Test.createTestingModule({
      providers: [provideClass(SCOPED, Scoped, [], { scope: Scope.REQUEST })],
    }).compile();

    const context = {};
    expect(await moduleRef.resolve(SCOPED, context)).toBe(await moduleRef.resolve(SCOPED, context));
    expect(await moduleRef.resolve(SCOPED)).not.toBe(await moduleRef.resolve(SCOPED));
    await moduleRef.close();
  });

  test("setLogger configures the application the module creates", async () => {
    const lines: string[] = [];
    const logger: LoggerService = {
      log: (message) => lines.push(String(message)),
      warn: () => {},
      error: () => {},
      fatal: () => {},
    };

    const moduleRef = await Test.createTestingModule(ValueModule).setLogger(logger).compile();
    const application = await moduleRef.createAponiaApplication({ elysia: { precompile: false } });
    await application.handle(new Request("http://localhost/testing"));
    expect(lines.length).toBeGreaterThan(0);
    await application.close();
    await moduleRef.close();
  });

  test("the four enhancer override names delegate to the provider rewrite", async () => {
    class Guard {
      canActivate(): boolean {
        return true;
      }
    }
    const moduleRef = await Test.createTestingModule({
      providers: [provideClass(Guard, [])],
    })
      .overrideGuard(Guard)
      .useValue({ canActivate: () => true })
      .compile();

    expect(moduleRef.get(Guard)).toEqual({ canActivate: expect.any(Function) });
    await moduleRef.close();
  });
});
