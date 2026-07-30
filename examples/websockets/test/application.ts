import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createServer } from "node:net";
import { AppModule } from "../src/app.module.ts";

export function createApplication(): Promise<AponiaElysiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
}

export async function listen(application: AponiaElysiaApplication): Promise<void> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve an ephemeral test port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  await application.listen(port);
}

export function connect(application: AponiaElysiaApplication): Promise<WebSocket> {
  const socketUrl = `${application.getUrl().replace("http://", "ws://")}/chat`;
  const socket = new WebSocket(socketUrl);

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")), {
      once: true,
    });
  });
}

export function send(
  socket: WebSocket,
  event: string,
  data?: unknown,
): Promise<Readonly<{ event: string; data: unknown }>> {
  const response = new Promise<Readonly<{ event: string; data: unknown }>>((resolve, reject) => {
    socket.addEventListener(
      "message",
      ({ data: message }) => {
        try {
          resolve(JSON.parse(String(message)) as Readonly<{ event: string; data: unknown }>);
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
  });
  socket.send(JSON.stringify({ event, data }));
  return response;
}
