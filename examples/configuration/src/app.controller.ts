import { Controller, Get } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  describe(): { readonly serviceName: string; readonly port: number } {
    return this.appService.describe();
  }
}
