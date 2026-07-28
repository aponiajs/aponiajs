import { Module } from "@aponiajs/common";
import { SettingsController } from "./settings.controller.ts";
import { SettingsModule } from "./settings.module.ts";

/**
 * Providers, tokens, and visibility. `SettingsModule` owns every provider kind
 * and decides what the rest of the application may see.
 */
@Module({
  imports: [SettingsModule],
  controllers: [SettingsController],
})
export class AppModule {}
