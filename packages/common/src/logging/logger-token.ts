import { createToken } from "../tokens/token.ts";
import type { InjectionToken } from "../tokens/token.types.ts";
import type { LoggerService } from "./logger.types.ts";

/**
 * Global injection token for the system logger resolved across all modules.
 *
 * Injected through `@Inject(LOGGER)` into services or controllers.
 */
export const LOGGER: InjectionToken<LoggerService> = createToken<LoggerService>("aponia.logger");
