import { MetricsExceptionFilter } from "@aponiajs/metrics";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application, with the health probes and metrics filter. */
export function createApplication(): Promise<AponiaApplication> {
  return AponiaFactory.create(AppModule, {
    logger: false,
    health: true,
    filters: [MetricsExceptionFilter],
  });
}

export function get(
  application: AponiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}

export function send(
  application: AponiaApplication,
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    application.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}
