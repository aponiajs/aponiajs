import { createToken, type InjectionToken } from "@aponiajs/common";
import type { ResolvedOpenTelemetryOptions } from "./interfaces/opentelemetry.interface.ts";

/** Internal token carrying validated OpenTelemetry options. */
export const OPENTELEMETRY_OPTIONS: InjectionToken<ResolvedOpenTelemetryOptions> =
  createToken<ResolvedOpenTelemetryOptions>("OPENTELEMETRY_OPTIONS");
