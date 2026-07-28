import { Module } from "@aponiajs/common";
import { BudgetPluginModule } from "./budget.plugin.ts";
import { clock } from "./clock.plugin.ts";
import { StatusController } from "./status.controller.ts";

/** Use case: mounting both plugin registration styles beside a controller. */
@Module({
  imports: [clock, BudgetPluginModule],
  controllers: [StatusController],
})
export class PluginsModule {}
