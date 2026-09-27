import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application and drives it through `handle`. */
export function createApplication(): Promise<AponiaElysiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
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
