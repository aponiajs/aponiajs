import { expect, test } from "bun:test";
import type { PipeTransform } from "../interfaces/pipe.interface.ts";
import {
  createApplicationSurfaceConfig,
  mergeApplicationSurfaceOptions,
} from "./application-surface.ts";
import type { AponiaHttpApplicationOptions } from "../interfaces/application.interface.ts";

class GuardA {}
class GuardB {}
class PipeA implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}
class LoggerReplacement {
  log(): void {}
  fatal(): void {}
  error(): void {}
  warn(): void {}
}

test("a surface configuration starts empty and disabled", () => {
  const surface = createApplicationSurfaceConfig();

  expect(surface).toEqual({
    guards: [],
    interceptors: [],
    pipes: [],
    filters: [],
    enabled: false,
  });
});

test("an empty surface leaves every factory option exactly as stated", () => {
  const guards = [GuardA];
  const options: AponiaHttpApplicationOptions = {
    guards,
    prefix: "/api",
    cors: { origin: "https://app.test" },
  };

  const merged = mergeApplicationSurfaceOptions(options, createApplicationSurfaceConfig());

  expect(merged.guards).toBe(guards);
  expect(merged.prefix).toBe("/api");
  expect(merged.cors).toEqual({ origin: "https://app.test" });
});

test("surface registrations append behind the factory options they repeat", () => {
  const surface = createApplicationSurfaceConfig();
  surface.guards.push(GuardB);
  surface.interceptors.push(GuardB);
  surface.filters.push(GuardB);
  surface.pipes.push(PipeA);
  surface.enabled = true;

  const merged = mergeApplicationSurfaceOptions({ guards: [GuardA], pipes: [] }, surface);

  expect(merged.guards).toEqual([GuardA, GuardB]);
  expect(merged.interceptors).toEqual([GuardB]);
  expect(merged.filters).toEqual([GuardB]);
  expect(merged.pipes).toEqual([PipeA]);
});

test("a surface declaration overrides the matching factory policy", () => {
  const surface = createApplicationSurfaceConfig();
  surface.cors = false;
  surface.securityHeaders = true;
  surface.prefix = "/next";
  surface.versioning = { type: "header", header: "x-api-version" };
  surface.logger = new LoggerReplacement();
  surface.enabled = true;

  const logger = surface.logger;
  const merged = mergeApplicationSurfaceOptions(
    {
      cors: { origin: "https://app.test" },
      securityHeaders: false,
      prefix: "/api",
      versioning: { type: "header", header: "x-old-version" },
      logger: false,
    },
    surface,
  );

  expect(merged.cors).toBe(false);
  expect(merged.securityHeaders).toBe(true);
  expect(merged.prefix).toBe("/next");
  expect(merged.versioning).toEqual({ type: "header", header: "x-api-version" });
  expect(merged.logger).toBe(logger);
});
