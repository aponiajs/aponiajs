import { Module } from "@aponiajs/common";
import { ElysiaPluginModule } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import { ConfigModule } from "../config/config.module.ts";
import { REQUEST_BUDGET } from "../config/config.tokens.ts";

/**
 * Use case: a plugin whose configuration comes from the container. The factory
 * resolves `REQUEST_BUDGET` from the modules listed in `imports`.
 */
@Module({
  imports: [
    ElysiaPluginModule.registerAsync({
      key: "budget",
      imports: [ConfigModule],
      inject: [REQUEST_BUDGET],
      useFactory: (budget: number) => new Elysia({ name: "budget" }).decorate("budget", budget),
    }),
  ],
})
export class BudgetPluginModule {}
