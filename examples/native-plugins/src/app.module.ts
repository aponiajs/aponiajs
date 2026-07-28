import { Module } from "@aponiajs/common";
import { BudgetPluginModule } from "./budget.plugin.ts";
import { clock } from "./clock.plugin.ts";
import { PluginContextController } from "./plugin-context.controller.ts";
import { SettingsModule } from "./settings.module.ts";

/**
 * Native Elysia plugins mounted as module imports, in both registration styles,
 * beside the controller that reads what they add.
 */
@Module({
  imports: [SettingsModule, clock, BudgetPluginModule],
  controllers: [PluginContextController],
})
export class AppModule {}
