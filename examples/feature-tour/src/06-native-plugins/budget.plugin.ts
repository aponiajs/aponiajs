import { Module } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { ProvidersModule } from "../01-providers/providers.module.ts";
import { REQUEST_BUDGET } from "../01-providers/provider-tokens.ts";

/**
 * A plugin whose configuration comes from the container: the factory resolves
 * `REQUEST_BUDGET` against the modules listed in `imports`.
 */
@Module({
  imports: [
    ElysiaPluginModule.registerAsync({
      key: "budget",
      imports: [ProvidersModule],
      inject: [REQUEST_BUDGET],
      useFactory: (budget: number) => new Elysia({ name: "budget" }).decorate("budget", budget),
    }),
  ],
})
export class BudgetPluginModule {}
