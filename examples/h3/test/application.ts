import { AponiaFactory, type H3AponiaApplication } from "@aponiajs/platform-h3";
import { AppModule } from "../src/app.module.ts";

/** Each suite boots the real application on H3 and drives it natively. */
export function createApplication(): Promise<H3AponiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false, prefix: "/api" });
}

export function send(
  application: H3AponiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(
    application.getNativeApplication().fetch(new Request(`http://localhost/api${path}`, init)),
  );
}
