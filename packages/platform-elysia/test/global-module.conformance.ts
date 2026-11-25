import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory, compileRootModule } from "@aponiajs/platform-elysia";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("a decorated global module reaches a module that does not import it", async () => {
  @Injectable()
  class GlobalService {
    readonly label = "from-global";
  }

  @Module({ global: true, providers: [GlobalService], exports: [GlobalService] })
  class GlobalModule {}

  @Controller("consumer")
  class ConsumerController {
    constructor(private readonly service: GlobalService) {}

    @Get()
    read(): { readonly label: string } {
      return { label: this.service.label };
    }
  }

  @Module({ controllers: [ConsumerController] })
  class ConsumerModule {}

  @Module({ imports: [GlobalModule, ConsumerModule] })
  class AppModule {}

  const definition = compileRootModule(AppModule);
  expect(definition.imports).toContainEqual(
    expect.objectContaining({ id: "GlobalModule", global: true }),
  );

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/consumer"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: "from-global" });
  } finally {
    await application.close();
  }
});
