import { AponiaFactory, type HonoAponiaApplication } from "@aponiajs/platform-hono";
import { AppModule } from "../src/app.module.ts";

/** Each suite boots the real application on Hono and drives it natively. */
export function createApplication(): Promise<HonoAponiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false, prefix: "/api" });
}

export function send(
  application: HonoAponiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.getNativeApplication().request(`/api${path}`, init));
}
