import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Module,
  createToken,
  defineModule,
  dynamicModule,
  provideValue,
  type DynamicModule,
} from "@aponiajs/common";
import {
  AponiaFactory,
  LazyModuleLoader,
  compileRootModule,
  compileRootModuleAsync,
} from "./index.ts";

const REGISTERED = createToken<string>("async.registration");

function asyncRegistration(): Promise<DynamicModule> {
  return Promise.resolve(
    dynamicModule({
      module: class AsyncFeature {},
      id: "AsyncFeature",
      providers: [provideValue(REGISTERED, "registered")],
      exports: [REGISTERED],
    }),
  );
}

@Controller("async")
class AsyncController {
  @Get()
  read(): string {
    return "async";
  }
}

@Module({ controllers: [AsyncController], imports: [asyncRegistration()] })
class AsyncRootModule {}

describe("asynchronous dynamic modules", () => {
  test("compileRootModule refuses a Promise import synchronously", () => {
    expect(() => compileRootModule(AsyncRootModule)).toThrow(
      expect.objectContaining({ code: "INVALID_MODULE" }),
    );
  });

  test("compileRootModuleAsync resolves a Promise import", async () => {
    const compiled = await compileRootModuleAsync(AsyncRootModule);
    expect(compiled.imports).toHaveLength(1);
    expect((compiled.imports[0] as { readonly id?: string }).id).toBe("AsyncFeature");
  });

  test("AponiaFactory.create awaits a Promise import and serves the route", async () => {
    const application = await AponiaFactory.create(AsyncRootModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/async"));
    expect(await response.text()).toBe("async");
    await application.close();
  });

  test("createApplicationContext resolves the asynchronous graph", async () => {
    const context = await AponiaFactory.createApplicationContext(AsyncRootModule, {
      logger: false,
    });
    expect(context.get(REGISTERED)).toBe("registered");
    await context.close();
  });

  test("LazyModuleLoader awaits a Promise import", async () => {
    const application = await AponiaFactory.create(AsyncRootModule, { logger: false });
    const loader = application.get(LazyModuleLoader);
    const loaded = await loader.load(() => AsyncRootModule);
    expect(loaded.get(REGISTERED)).toBe("registered");
    await loaded.close();
    await application.close();
  });

  test("a descriptor root is left alone by the asynchronous resolver", async () => {
    const descriptor = defineModule({
      id: "descriptor-root",
      providers: [provideValue(REGISTERED, "descriptor")],
      exports: [REGISTERED],
    });
    const compiled = await compileRootModuleAsync(descriptor);
    expect(compiled).toBe(descriptor);
  });
});
