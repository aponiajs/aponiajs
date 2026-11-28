import { Controller, Get, Injectable, Module, type CanActivate } from "@aponiajs/common";
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

@Injectable()
class RefusingGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Controller("surface")
class SurfaceController {
  @Get()
  read(): string {
    return "surface";
  }
}

@Module({ controllers: [SurfaceController], providers: [RefusingGuard] })
class SurfaceModule {}

test("boots on H3 and answers a declared route", async () => {
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

test("the shared application surface applies a global guard and headers at init", async () => {
  const application = await AponiaFactory.create(SurfaceModule, { logger: false });
  try {
    expect((await application.handle(new Request("http://localhost/surface"))).status).toBe(200);

    application.useGlobalGuards(RefusingGuard).useSecurityHeaders();
    expect(await application.init()).toBe(application);

    const refused = await application.handle(new Request("http://localhost/surface"));
    expect(refused.status).toBe(403);
    expect(refused.headers.get("x-content-type-options")).toBe("nosniff");
  } finally {
    await application.close();
  }
});

import {
  conformanceCreate,
  platformConformanceCases,
} from "../../common/test/support/platform-contract.ts";

const sharedContractCreate = conformanceCreate((root, options) =>
  AponiaFactory.create(root, options),
);

for (const conformanceCase of platformConformanceCases) {
  test(`the shared platform contract: ${conformanceCase.name}`, async () => {
    await conformanceCase.run(sharedContractCreate);
  });
}
