import { Inject, Injectable } from "@aponiajs/common";
import { APPLICATION_NAME, GREETING_PREFIX } from "./provider-tokens.ts";

/** A class provider whose dependencies arrive through tokens. */
@Injectable()
export class SettingsService {
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
