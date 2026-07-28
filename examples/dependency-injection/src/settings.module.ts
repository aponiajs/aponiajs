import { Module, createToken, provideAlias, provideFactory, provideValue } from "@aponiajs/common";
import { APPLICATION_NAME, GREETING_PREFIX, REQUEST_BUDGET } from "./settings.tokens.ts";
import { SettingsService } from "./settings.service.ts";

/**
 * Every provider kind in one module.
 *
 * `INTERNAL_BUDGET` is never exported, so importing modules cannot see it.
 * `REQUEST_BUDGET` aliases it for the modules that are allowed to read it.
 */
const INTERNAL_BUDGET = createToken<number>("INTERNAL_BUDGET");

@Module({
  providers: [
    provideValue(APPLICATION_NAME, "dependency-injection"),
    provideFactory(GREETING_PREFIX, [APPLICATION_NAME], (name) => `Hello from ${name}`),
    provideValue(INTERNAL_BUDGET, 100),
    provideAlias(REQUEST_BUDGET, INTERNAL_BUDGET),
    SettingsService,
  ],
  exports: [SettingsService, GREETING_PREFIX, REQUEST_BUDGET],
})
export class SettingsModule {}
