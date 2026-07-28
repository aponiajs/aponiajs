import { Controller, Get } from "@aponiajs/common";
import { GreetingService } from "./greeting.service.ts";

@Controller("greetings")
export class GreetingController {
  constructor(private readonly greetingService: GreetingService) {}

  @Get()
  getGreeting(): string {
    return this.greetingService.createGreeting();
  }
}
