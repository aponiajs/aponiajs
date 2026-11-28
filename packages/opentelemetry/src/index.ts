export { OpenTelemetryModule } from "./opentelemetry.module.ts";
export { OpenTelemetryService } from "./opentelemetry.service.ts";
export { OPENTELEMETRY_OPTIONS } from "./opentelemetry.constants.ts";
export {
  ASYNC_OPTIONS_TYPE,
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE,
  type OpenTelemetryModuleExtras,
  type OpenTelemetryModuleRegistrationAsyncOptions,
  type OpenTelemetryModuleSyncOptions,
} from "./opentelemetry.module-definition.ts";
export type {
  ActiveSpan,
  OpenTelemetryModuleAsyncOptions,
  OpenTelemetryModuleOptions,
  ResolvedOpenTelemetryOptions,
  SpanAttributes,
} from "./interfaces/opentelemetry.interface.ts";
