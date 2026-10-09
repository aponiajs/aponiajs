import { Injectable } from "@aponiajs/common";

@Injectable()
export class GreetingService {
  createGreeting(): string {
    return "Hello, AponiaJS!";
  }
}
