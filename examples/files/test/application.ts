import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createServer } from "node:net";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application and drives it through `handle`. */
export function createApplication(): Promise<AponiaElysiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
}

/**
 * A native directory route is Bun's, not Elysia's: it is composed when the server
 * starts, so the suite that exercises one listens on a reserved ephemeral port
 * instead of driving `handle` the way every other lane does.
 */
export async function reservePort(): Promise<number> {
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
  return port;
}

export function get(
  application: AponiaElysiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}

/**
 * A multipart request carries the boundary its body was encoded with, so the
 * `content-type` header is the engine's to write and must not be set by hand.
 */
export function upload(
  application: AponiaElysiaApplication,
  path: string,
  form: FormData,
): Promise<Response> {
  return Promise.resolve(
    application.handle(new Request(`http://localhost${path}`, { method: "POST", body: form })),
  );
}

/** One uploaded part, with the name on disk, the bytes, and the declared type. */
export function file(
  name: string,
  bytes: Uint8Array | string,
  type = "application/octet-stream",
): File {
  return new File([bytes], name, { type });
}

/** Builds a form from `{ field: part | parts[] }`, appending in declaration order. */
export function form(parts: Record<string, File | string | readonly File[]>): FormData {
  const body = new FormData();
  for (const [field, value] of Object.entries(parts)) {
    const entries = typeof value === "string" || value instanceof File ? [value] : value;
    for (const entry of entries) {
      body.append(field, entry);
    }
  }
  return body;
}
