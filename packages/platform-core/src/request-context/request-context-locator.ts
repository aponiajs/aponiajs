import type { AponiaContainer } from "@aponiajs/core";
import { REQUEST_CONTEXT_REGISTRATION } from "./request-context.service.ts";
import type { RequestContextRegistration } from "../interfaces/request-context.interface.ts";

/**
 * Finds the request-context registration a module graph holds, if any.
 *
 * @internal
 */
export function locateRequestContext(
  container: AponiaContainer,
): RequestContextRegistration | undefined {
  try {
    const owner = container.graph.locate(container.graph.root, REQUEST_CONTEXT_REGISTRATION);
    return container.resolveModuleProvider(
      owner.module,
      REQUEST_CONTEXT_REGISTRATION,
    ) as RequestContextRegistration;
  } catch {
    for (const module of container.graph.modules) {
      try {
        container.graph.locate(module, REQUEST_CONTEXT_REGISTRATION);
        return container.resolveModuleProvider(
          module,
          REQUEST_CONTEXT_REGISTRATION,
        ) as RequestContextRegistration;
      } catch {
        // This module cannot reach the registration; keep looking.
      }
    }
    return undefined;
  }
}
