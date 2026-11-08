import { afterEach, describe, expect, test } from "bun:test";
import {
  Controller,
  EventPattern,
  MessagePattern,
  Module,
  Payload,
  type MicroserviceTransport,
} from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { InMemoryTransport, MicroserviceCallError } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

const seen: string[] = [];

@Controller("users")
class UsersController {
  @MessagePattern("users.findOne")
  findOne(@Payload("id") id: string): { readonly id: string; readonly found: true } {
    return { id, found: true };
  }

  @MessagePattern("users.sum")
  sum(payload: { readonly a: number; readonly b: number }): number {
    return payload.a + payload.b;
  }

  @EventPattern("users.created")
  created(@Payload("id") id: string): string {
    seen.push(id);
    return "ignored";
  }

  @MessagePattern("users.fail")
  fail(): never {
    throw new Error("internal database password");
  }

  @MessagePattern(7)
  numeric(): string {
    return "seven";
  }
}

@Module({ controllers: [UsersController] })
class UsersModule {}

describe("microservice transports", () => {
  test("answers requests, binds payload properties, and runs event handlers", async () => {
    const transport = new InMemoryTransport();
    application = await AponiaFactory.create(UsersModule, {
      logger: false,
      microservices: [transport],
    });

    expect(
      await transport.send<{ readonly id: string; readonly found: true }>("users.findOne", {
        id: "42",
      }),
    ).toEqual({ id: "42", found: true });
    expect(
      await transport.send<{ readonly id: string | undefined; readonly found: true }>(
        "users.findOne",
        "not-an-object",
      ),
    ).toEqual({
      id: undefined,
      found: true,
    });
    expect(await transport.send<number>("users.sum", { a: 2, b: 3 })).toBe(5);
    expect(await transport.send<string>(7)).toBe("seven");

    await transport.emit("users.created", { id: "u1" });
    expect(seen).toEqual(["u1"]);
    expect(await transport.send("users.created", { id: "u2" })).toBeUndefined();
  });

  test("reports an unknown pattern and a failed handler without internals", async () => {
    const transport = new InMemoryTransport({ name: "local" });
    application = await AponiaFactory.create(UsersModule, {
      logger: false,
      microservices: [transport],
    });

    const unknown = await transport.send("users.missing").catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(MicroserviceCallError);
    expect(unknown).toMatchObject({
      code: "UNKNOWN_MESSAGE_PATTERN",
      message: 'No handler is registered for pattern "users.missing".',
    });

    const failed = await transport.send("users.fail").catch((error: unknown) => error);
    expect(failed).toMatchObject({
      code: "MESSAGE_HANDLER_ERROR",
      message: "The message handler failed.",
    });
    expect(String((failed as Error).message)).not.toContain("password");
    expect((failed as Error).stack).not.toContain("password");
  });

  test("refuses to call before connect and after close", async () => {
    const transport = new InMemoryTransport();
    const disconnected = await transport.send("users.findOne").catch((error: unknown) => error);
    expect(disconnected).toMatchObject({ code: "TRANSPORT_NOT_CONNECTED" });

    application = await AponiaFactory.create(UsersModule, {
      logger: false,
      microservices: [transport],
    });
    await application.close();
    application = undefined;

    const closed = await transport.send("users.findOne").catch((error: unknown) => error);
    expect(closed).toMatchObject({ code: "TRANSPORT_NOT_CONNECTED" });
    expect(await transport.send("").catch((error: unknown) => error)).toBeInstanceOf(TypeError);
  });

  test("refuses a duplicate pattern before any transport connects", async () => {
    @Controller("duplicate")
    class DuplicateController {
      @MessagePattern("users.findOne")
      read(): string {
        return "duplicate";
      }
    }

    @Module({ controllers: [UsersController, DuplicateController] })
    class DuplicateModule {}

    const failure = await AponiaFactory.create(DuplicateModule, {
      logger: false,
      microservices: [new InMemoryTransport()],
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "DUPLICATE_MESSAGE_PATTERN",
      details: { pattern: "users.findOne" },
    });
  });

  test("refuses invalid and duplicated transports in one refusal", async () => {
    @Module({})
    class EmptyModule {}

    const failure = await AponiaFactory.create(EmptyModule, {
      logger: false,
      microservices: [
        {} as MicroserviceTransport,
        new InMemoryTransport({ name: "memory" }),
        new InMemoryTransport({ name: "memory" }),
      ],
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "INVALID_MICROSERVICE_TRANSPORT" });
    expect((failure as { details: { issues: string[] } }).details.issues).toEqual([
      "microservices[0].name must be a non-empty string",
      "microservices[0].subscribe must be a function",
      "microservices[0].close must be a function",
      'microservices[2] repeats the transport name "memory"',
    ]);
  });

  test("closes started transports when a later transport refuses to start", async () => {
    let closed = 0;
    const healthy: MicroserviceTransport = {
      name: "healthy",
      subscribe: () => undefined,
      close: () => {
        closed += 1;
      },
    };
    const broken: MicroserviceTransport = {
      name: "broken",
      subscribe: () => {
        throw new Error("broker refused");
      },
      close: () => undefined,
    };

    @Module({})
    class EmptyModule {}

    const failure = await AponiaFactory.create(EmptyModule, {
      logger: false,
      microservices: [healthy, broken],
    }).catch((error: unknown) => error);

    expect(failure).toEqual(new Error("broker refused"));
    expect(closed).toBe(1);
  });

  test("serves one application per transport instance", async () => {
    const shared = new InMemoryTransport();
    application = await AponiaFactory.create(UsersModule, {
      logger: false,
      microservices: [shared],
    });

    const second = await AponiaFactory.create(UsersModule, {
      logger: false,
      microservices: [shared],
    }).catch((error: unknown) => error);

    expect(second).toMatchObject({ code: "INVALID_MICROSERVICE_TRANSPORT" });
    expect((second as { details: { transport: string } }).details.transport).toBe("memory");
  });

  test("requires a non-empty transport name", () => {
    expect(() => new InMemoryTransport({ name: " " })).toThrow(TypeError);
  });

  test("reports an event failure and survives a transport that refuses to close", async () => {
    const transport = new InMemoryTransport();
    const failingClose: MicroserviceTransport = {
      name: "failing-close",
      subscribe: () => undefined,
      close: () => {
        throw new Error("close refused");
      },
    };
    application = await AponiaFactory.create(UsersModule, {
      logger: false,
      microservices: [transport, failingClose],
    });

    const failure = await transport.emit("users.fail").catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "MESSAGE_HANDLER_ERROR" });

    await application.close();
    application = undefined;
    expect(await transport.send("users.findOne").catch((error: unknown) => error)).toMatchObject({
      code: "TRANSPORT_NOT_CONNECTED",
    });
  });

  test("refuses a message pattern on a member that is not a method", async () => {
    @Controller("broken")
    class BrokenController {
      @MessagePattern("broken.value")
      get value(): string {
        return "not a handler";
      }
    }

    @Module({ controllers: [BrokenController] })
    class BrokenModule {}

    const failure = await AponiaFactory.create(BrokenModule, {
      logger: false,
      microservices: [new InMemoryTransport()],
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "INVALID_CONTROLLER",
      details: { propertyKey: "value" },
    });
  });
});
