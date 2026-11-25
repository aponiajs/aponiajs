import { createToken } from "../tokens/token.ts";
import type { InjectionToken } from "../interfaces/token.interface.ts";
import type { LoggerService } from "../interfaces/logger.interface.ts";

/**
 * Global injection token for the system logger resolved across all modules.
 *
 * Injected through `@Inject(LOGGER)` into services or controllers.
 */
export const LOGGER: InjectionToken<LoggerService> = createToken<LoggerService>("aponia.logger");
