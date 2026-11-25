import type { LoggerService } from "@aponiajs/common";
import {
  getApplicationContainer,
  readBootDiagnostics,
  type AponiaBootDiagnostics,
} from "@aponiajs/platform-core";
import { createHandlers } from "../../src/server/devtools-server.ts";
import type { DevtoolsHandlers } from "../../src/interfaces/devtools-server.interface.ts";
import type { LogStream } from "../../src/logging/log-tap.ts";
import type { RequestBuffer } from "../../src/interfaces/request-buffer.interface.ts";

/** The neutral boot record one booted application published. */
export function diagnosticsOf(application: unknown): AponiaBootDiagnostics | undefined {
  if (application === undefined || application === null) {
    return undefined;
  }
  const native =
    (application as { getHttpAdapter?: () => unknown }).getHttpAdapter?.() ?? application;
  const container = getApplicationContainer(native);
  return container === undefined ? undefined : readBootDiagnostics(container);
}

/** The surface handlers one booted application answers with. */
export function handlersOf(
  application: unknown,
  logs: LogStream | undefined,
  requests: RequestBuffer | undefined,
  logger: LoggerService,
): DevtoolsHandlers {
  return createHandlers(diagnosticsOf(application), logs, requests, logger);
}
