import { Controller, Get } from "@aponiajs/common";
import { SettingsService } from "./settings.service.ts";

/** Reads what the providers resolved to, so a test can assert it over HTTP. */
@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  read(): { application: string; prefix: string } {
    return this.settingsService.describe();
  }
}
