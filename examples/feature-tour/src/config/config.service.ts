import { Inject, Injectable } from "@aponiajs/common";
import { APPLICATION_NAME, GREETING_PREFIX } from "./config.tokens.ts";

/** Use case: a class provider that receives token-identified values. */
@Injectable()
export class ConfigService {
  constructor(
    @Inject(APPLICATION_NAME) private readonly applicationName: string,
    @Inject(GREETING_PREFIX) private readonly greetingPrefix: string,
  ) {}

  describe(): { application: string; prefix: string } {
    return { application: this.applicationName, prefix: this.greetingPrefix };
  }

  greet(name: string): string {
    return `${this.greetingPrefix}, ${name}!`;
  }
}
