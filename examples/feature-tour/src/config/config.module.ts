import { Module, createToken, provideAlias, provideFactory, provideValue } from "@aponiajs/common";
import { ConfigService } from "./config.service.ts";
import { APPLICATION_NAME, GREETING_PREFIX, REQUEST_BUDGET } from "./config.tokens.ts";

/**
 * Use case: every provider kind in one module.
 *
 * `INTERNAL_BUDGET` is never exported, so it stays invisible to importing
 * modules. `REQUEST_BUDGET` aliases it for the modules allowed to read it.
 */
const INTERNAL_BUDGET = createToken<number>("INTERNAL_BUDGET");

@Module({
  providers: [
    provideValue(APPLICATION_NAME, "feature-tour"),
    provideFactory(GREETING_PREFIX, [APPLICATION_NAME], (name) => `Hello from ${name}`),
    provideValue(INTERNAL_BUDGET, 100),
    provideAlias(REQUEST_BUDGET, INTERNAL_BUDGET),
    ConfigService,
  ],
  exports: [ConfigService, GREETING_PREFIX, REQUEST_BUDGET],
})
export class ConfigModule {}
