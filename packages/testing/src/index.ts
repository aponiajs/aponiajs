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
export { createTestApplication } from "./application/test-application.builder.ts";
export {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
  teardownIssues,
} from "./conformance/plugin-conformance.ts";
export type {
  PluginConformanceOptions,
  PluginRegistrationSurface,
} from "./conformance/plugin-conformance.ts";
export { Test } from "./application/test.ts";
export { TestApplication } from "./application/test-application.ts";
export {
  PlatformTestApplication,
  wrapPlatformApplication,
} from "./application/platform-test-application.ts";
export type { TestableApplication } from "./interfaces/platform-test-application.interface.ts";
export type {
  TestApplicationBuilder,
  TestProviderOverride,
} from "./interfaces/test-application-builder.interface.ts";
export type {
  ModuleOverrideBuilder,
  OverrideFactoryOptions,
  OverrideProviderBuilder,
  TestingModule,
  TestingModuleBuilder,
} from "./interfaces/testing-module.interface.ts";
export type {
  TestApplicationOptions,
  TestServer,
} from "./interfaces/test-application.interface.ts";
