import { Module } from "@aponiajs/common";
import { BudgetPluginModule } from "./budget.plugin.ts";
import { clock } from "./clock.plugin.ts";
import { PluginContextController } from "./plugin-context.controller.ts";

/** Both registration styles mounted beside the controller that reads them. */
@Module({
  imports: [clock, BudgetPluginModule],
  controllers: [PluginContextController],
})
export class NativePluginsModule {}
