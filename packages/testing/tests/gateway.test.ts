import { expect, test } from "bun:test";
import {
  MessageBody,
  Module,
  SubscribeMessage,
  WebSocketGateway,
  type WsResponse,
} from "@aponiajs/common";
import { createTestApplication } from "../src/index.ts";

@WebSocketGateway("/chat")
class ChatGateway {
  @SubscribeMessage("chat.send")
  send(@MessageBody("text") text: string): WsResponse<{ text: string }> {
    return { event: "chat.message", data: { text } };
  }
}

/** A root whose only provider is the gateway. */
function gatewayRoot() {
  @Module({ providers: [ChatGateway] })
  class Root {}
  return Root;
}

function open(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), {
      once: true,
    });
  });
}

function send(socket: WebSocket, event: string, data?: unknown): Promise<unknown> {
  const reply = new Promise<unknown>((resolve, reject) => {
    socket.addEventListener(
      "message",
      ({ data: message }) => {
        try {
          resolve(JSON.parse(String(message)));
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
  });
  socket.send(JSON.stringify({ event, data }));
  return reply;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve(), { once: true });
  });
  socket.close();
  await closed;
}

test("serves a gateway over a real socket the harness bound", async () => {
  const application = await createTestApplication(gatewayRoot()).compile();
  let socket: WebSocket | undefined;

  try {
    const server = await application.listen();
    socket = await open(`${server.webSocketUrl}/chat`);

    // The envelope is the adapter's own protocol: what was sent is what comes
    // back under the event the handler chose, which is the whole reason a
    // gateway case needs a socket rather than `handle`.
    expect(await send(socket, "chat.send", { text: "Hello" })).toEqual({
      event: "chat.message",
      data: { text: "Hello" },
    });
  } finally {
    if (socket) {
      await closeSocket(socket);
    }
    await application.close();
  }
});
