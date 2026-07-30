import { afterEach, expect, test } from "bun:test";
import type { AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { connect, createApplication, listen, send } from "./application.ts";

let application: AponiaElysiaApplication | undefined;
let socket: WebSocket | undefined;

afterEach(async () => {
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    const closed = new Promise<void>((resolve) => {
      socket!.addEventListener("close", () => resolve(), { once: true });
    });
    socket.close();
    await Promise.race([
      closed,
      Bun.sleep(250).then(() => {
        socket?.terminate();
      }),
    ]);
  }
  await application?.close();
  socket = undefined;
  application = undefined;
});

test("dispatches named gateway messages through the native Elysia socket", async () => {
  application = await createApplication();
  await listen(application);
  socket = await connect(application);

  const message = await send(socket, "chat.send", { text: "Hello" });
  const zero = await send(socket, "chat.zero");

  expect(message.event).toBe("chat.message");
  expect(message.data).toEqual({
    clientId: expect.any(String),
    text: "Hello",
  });
  expect(zero).toEqual({ event: "chat.zero", data: 0 });
});

test("returns safe exception frames for unknown events and handler failures", async () => {
  application = await createApplication();
  await listen(application);
  socket = await connect(application);

  const unknown = await send(socket, "chat.missing");
  const failure = await send(socket, "chat.fail");

  expect(unknown).toMatchObject({
    event: "exception",
    data: { code: "UNKNOWN_WEBSOCKET_EVENT" },
  });
  expect(failure).toMatchObject({
    event: "exception",
    data: { code: "WEBSOCKET_HANDLER_ERROR" },
  });
  expect(JSON.stringify(failure)).not.toContain("Internal details");
});
