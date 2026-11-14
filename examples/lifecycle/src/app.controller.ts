import { Controller, Get } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

@Controller("lifecycle")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("record")
  read(): { started: boolean } {
    return this.appService.record();
  }
}
