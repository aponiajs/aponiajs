import { Controller, MessagePattern, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Controller("math")
class MathController {
  @MessagePattern("math.double")
  double(value: number): number {
    return value * 2;
  }
}

@Module({ controllers: [MathController] })
class MathModule {}

test("answers a message through the in-memory transport", async () => {
  const transport = new InMemoryTransport();
  const application = await AponiaFactory.create(MathModule, {
    logger: false,
    microservices: [transport],
  });
  try {
    expect(await transport.send("math.double", 21)).toBe(42);
  } finally {
    await application.close();
  }
});
