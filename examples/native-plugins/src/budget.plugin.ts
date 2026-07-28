import { Module } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { REQUEST_BUDGET, SettingsModule } from "./settings.module.ts";

/**
 * A plugin whose configuration comes from the container: the factory resolves
 * `REQUEST_BUDGET` against the modules listed in `imports`.
 */
@Module({
  imports: [
    ElysiaPluginModule.registerAsync({
      key: "budget",
      imports: [SettingsModule],
      inject: [REQUEST_BUDGET],
      useFactory: (budget: number) => new Elysia({ name: "budget" }).decorate("budget", budget),
    }),
  ],
})
export class BudgetPluginModule {}
