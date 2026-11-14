import { Controller, Get } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/greetings")
  greet(): { readonly greeting: string; readonly served: number } {
    return this.appService.greet();
  }

  @Get()
  health(): { readonly ok: boolean } {
    return { ok: true };
  }
}
