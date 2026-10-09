import { describe, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { Elysia } from "elysia";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { wrapElysiaPlugin } from "../src/plugins/elysia-bridge-plugin.ts";

function createEchoElysiaPlugin(options: { prefix: string }) {
  return new Elysia({ name: "echo-plugin" }).get(
    `${options.prefix}/ping`,
    () => "pong from native plugin",
  );
}

const EchoBridgeModule = wrapElysiaPlugin({
  name: "echo-bridge",
  plugin: createEchoElysiaPlugin,
});

describe("wrapElysiaPlugin", () => {
  test("mounts native Elysia plugin routes seamlessly using forRoot", async () => {
    @Module({
      imports: [EchoBridgeModule.forRoot({ prefix: "/api" })],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    try {
      const res = await app.handle(new Request("http://localhost/api/ping"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pong from native plugin");
    } finally {
      await app.close();
    }
  });

  test("mounts native Elysia plugin routes using forRootAsync", async () => {
    @Module({
      imports: [
        EchoBridgeModule.forRootAsync({
          useFactory: () => ({ prefix: "/v2" }),
        }),
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    try {
      const res = await app.handle(new Request("http://localhost/v2/ping"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pong from native plugin");
    } finally {
      await app.close();
    }
  });
});
