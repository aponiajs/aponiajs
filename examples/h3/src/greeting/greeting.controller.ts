import { Controller, Get, Param } from "@aponiajs/common";
import { GreetingService } from "./greeting.service.ts";

@Controller("greetings")
export class GreetingController {
  constructor(private readonly service: GreetingService) {}

  @Get(":name")
  greet(@Param("name") name: string): { readonly message: string } {
    return { message: this.service.greet(name) };
  }
}
