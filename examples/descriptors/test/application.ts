import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application and drives it through `handle`. */
export function createApplication() {
  return AponiaFactory.create(AppModule, { logger: false });
}

export type DescriptorApplication = Awaited<ReturnType<typeof createApplication>>;

export function get(
  application: DescriptorApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}

export function send(
  application: DescriptorApplication,
  path: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return Promise.resolve(
    application.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}
