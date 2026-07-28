import { Controller, Get, Inject } from "@aponiajs/common";
import { SettingsService } from "./settings.service.ts";
import { REQUEST_BUDGET } from "./settings.tokens.ts";

/** Exposes what each provider resolved to, so a test can assert it over HTTP. */
@Controller("settings")
export class SettingsController {
  #reads = 0;

  constructor(
    private readonly settingsService: SettingsService,
    @Inject(REQUEST_BUDGET) private readonly budget: number,
  ) {}

  @Get()
  read(): { application: string; prefix: string } {
    return this.settingsService.describe();
  }

  @Get("greeting")
  readGreeting(): { greeting: string } {
    return { greeting: this.settingsService.greet("catalog") };
  }

  @Get("budget")
  readBudget(): { budget: number } {
    return { budget: this.budget };
  }

  @Get("reads")
  countReads(): { reads: number } {
    this.#reads += 1;
    return { reads: this.#reads };
  }
}
