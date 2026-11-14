import { expect, test } from "bun:test";
import { createMicroserviceClient, createMicroserviceServer, grpcTransport } from "../src/index.ts";

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

test("validates its options and its lifecycle", async () => {
  expect(() => grpcTransport({})).toThrow(
    expect.objectContaining({ code: "INVALID_MICROSERVICE_OPTIONS" }),
  );

  const transport = grpcTransport({ address: "127.0.0.1:1" });
  expect(transport.address).toBe("127.0.0.1:1");

  expect(await failureOf(() => transport.publish("nowhere", new Uint8Array()))).toMatchObject({
    code: "INVALID_MICROSERVICE_TRANSPORT",
  });

  await transport.close();
  expect(await failureOf(() => transport.connect())).toMatchObject({
    code: "INVALID_MICROSERVICE_TRANSPORT",
  });
  await transport.close();
});

test("reports a client publish failure when no server answers", async () => {
  const transport = grpcTransport({ address: "127.0.0.1:1" });
  await transport.connect();

  try {
    expect(await failureOf(() => transport.publish("nowhere", new Uint8Array()))).toMatchObject({
      code: "INVALID_MICROSERVICE_TRANSPORT",
    });
  } finally {
    await transport.close();
  }
});

test("reports a bind failure and closes a subscription handle", async () => {
  let address: string | undefined;
  const first = grpcTransport({
    listen: "127.0.0.1:0",
    onListen: (bound) => {
      address = bound;
    },
  });
  await first.connect();
  await first.connect();

  try {
    const second = grpcTransport({ listen: address! });
    expect(await failureOf(() => second.connect())).toMatchObject({
      code: "INVALID_MICROSERVICE_TRANSPORT",
    });
    await second.close();

    const client = grpcTransport({ address: address! });
    await client.connect();
    const handle = await client.subscribe({ destination: "unused" }, () => "ack");
    await handle.close();
    await client.close();
  } finally {
    await first.close();
  }
});

test("round-trips a request and an event over gRPC", async () => {
  let address: string | undefined;
  const serverTransport = grpcTransport({
    listen: "127.0.0.1:0",
    onListen: (bound) => {
      address = bound;
    },
  });
  const server = createMicroserviceServer({
    transport: serverTransport,
    subscriptions: [{ destination: "aponia.grpc.requests" }],
    replyDestinations: ["aponia.grpc.replies"],
  });

  await server.subscribe(async (message) => ({ ok: true, value: message.data }));
  expect(address).toBeDefined();

  const client = createMicroserviceClient({
    transport: grpcTransport({ address: address! }),
    destination: "aponia.grpc.requests",
    replyTo: "aponia.grpc.replies",
    requestTimeoutMs: 5_000,
    connectTimeoutMs: 5_000,
  });

  await client.connect();
  try {
    expect(await client.send("grpc.echo", { id: 1 })).toEqual({ id: 1 });
    await client.emit("grpc.event", { id: 2 });
  } finally {
    await client.close();
    await server.close();
  }
});
