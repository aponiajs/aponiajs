import { Controller, Module, Post } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { IDEMPOTENCY_STORE, IdempotencyModule, MODULE_OPTIONS_TOKEN } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("registers IdempotencyModule and replays POST responses", async () => {
  let count = 0;

  @Controller("tx")
  class TxController {
    @Post()
    run(): { readonly count: number } {
      count += 1;
      return { count };
    }
  }

  @Module({
    imports: [IdempotencyModule.forRoot()],
    controllers: [TxController],
  })
  class AppModule {}

  const def = IdempotencyModule.forRoot();
  expect(def.exports).toContain(MODULE_OPTIONS_TOKEN);
  expect(def.exports).toContain(IDEMPOTENCY_STORE);

  const app = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const first = await app.handle(
      new Request("http://localhost/tx", {
        method: "POST",
        headers: { "idempotency-key": "tx-1" },
      }),
    );
    const second = await app.handle(
      new Request("http://localhost/tx", {
        method: "POST",
        headers: { "idempotency-key": "tx-1" },
      }),
    );
    expect(first.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(count).toBe(1);
  } finally {
    await app.close();
  }
});
