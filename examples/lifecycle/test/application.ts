import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application; the topic's state is module-level. */
export function createApplication(): Promise<AponiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
}

export function get(
  application: AponiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}
