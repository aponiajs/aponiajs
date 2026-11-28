import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { InMemoryTransport } from "@aponiajs/microservices";
import { AppModule } from "../src/app.module.ts";
import { MathService } from "../src/math/math.service.ts";

test("dispatches request/response and events through configured microservice transport", async () => {
  const transport = new InMemoryTransport();
  const application = await AponiaFactory.create(AppModule, {
    logger: false,
    microservices: [transport],
  });

  try {
    const doubled = await transport.send("math.double", 21);
    expect(doubled).toBe(42);

    const sum = await transport.send("math.sum", { a: 10, b: 32 });
    expect(sum).toBe(42);

    await transport.emit("math.record", 15);
    const service = application.get(MathService);
    expect(service.accumulated).toBe(15);
  } finally {
    await application.close();
  }
});
