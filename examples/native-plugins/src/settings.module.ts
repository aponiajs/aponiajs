import { Module, createToken, provideValue } from "@aponiajs/common";

/** The configuration the asynchronously registered plugin reads. */
export const REQUEST_BUDGET = createToken<number>("REQUEST_BUDGET");

@Module({
  providers: [provideValue(REQUEST_BUDGET, 100)],
  exports: [REQUEST_BUDGET],
})
export class SettingsModule {}
