import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("greetings")
class GreetingController {
  @Get()
  index(): { readonly ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [GreetingController] })
class ConformanceModule {}

test("boots on Hono and answers a declared route", async () => {
  const application = await AponiaFactory.create(ConformanceModule, { logger: false });
  const response = await application.getNativeApplication().request("/greetings");

  expect(response.status).toBe(200);
  expect(application.platform).toBe("h3");
  await application.close();
});

test("declines a request it has no route for", async () => {
  const application = await AponiaFactory.create(ConformanceModule, { logger: false });

  expect(await application.tryHandle(new Request("http://localhost/none"))).toBeUndefined();
  await application.close();
});

import {
  conformanceCreate,
  platformConformanceCases,
} from "../../platform-core/tests/support/platform-contract.ts";

const sharedContractCreate = conformanceCreate((root, options) =>
  AponiaFactory.create(root, options),
);

for (const conformanceCase of platformConformanceCases) {
  test(`the shared platform contract: ${conformanceCase.name}`, async () => {
    await conformanceCase.run(sharedContractCreate);
  });
}
