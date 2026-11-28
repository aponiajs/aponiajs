import { Injectable } from "@aponiajs/common";

@Injectable()
export class GreetingService {
  greet(name: string): string {
    return `hello ${name}`;
  }
}
