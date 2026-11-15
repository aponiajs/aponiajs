import { Controller, Get, Module, Version } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("greet")
class GreetController {
  @Get()
  @Version("1")
  one(): { readonly version: number } {
    return { version: 1 };
  }

  @Get()
  @Version("2")
  two(): { readonly version: number } {
    return { version: 2 };
  }
}

@Module({ controllers: [GreetController] })
class PrefixedModule {}

test("the Vite+ lane mounts routes and negotiates versions under a prefix", async () => {
  const application = await AponiaFactory.create(PrefixedModule, {
    logger: false,
    prefix: "/api",
    versioning: { type: "header" },
  });

  try {
    expect((await application.handle(new Request("http://localhost/greet"))).status).toBe(404);

    const versioned = await application.handle(
      new Request("http://localhost/api/greet", { headers: { "x-api-version": "2" } }),
    );
    expect(versioned.status).toBe(200);
    expect(await versioned.json()).toEqual({ version: 2 });
  } finally {
    await application.close();
  }
});
