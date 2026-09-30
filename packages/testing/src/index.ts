/**
 * `@aponiajs/testing` — boot an Aponia application for a test.
 *
 * It adds no test runner and no mocking framework. What it adds is the three
 * things the framework's own test story was missing: a boot with sane defaults
 * and a teardown a case can rely on, a way to replace one provider for one
 * test application, and a port for the WebSocket case that genuinely needs one.
 * An application with nothing overridden boots exactly as
 * `AponiaFactory.create` boots it, and an application with a controller is
 * still asserted through `handle(new Request(...))` with no socket at all — a
 * reader who wants none of this can keep using `@aponiajs/platform-elysia`
 * directly.
 */
export { createTestApplication } from "./application/test-application-builder.ts";
export { TestApplication } from "./application/test-application.ts";
export type {
  TestApplicationBuilder,
  TestProviderOverride,
} from "./application/test-application-builder.types.ts";
export type { TestApplicationOptions, TestServer } from "./application/test-application.types.ts";
