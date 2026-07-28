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

export function send(
  application: AponiaElysiaApplication,
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
