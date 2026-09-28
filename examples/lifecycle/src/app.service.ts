import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@aponiajs/common";

/**
 * What the hooks announced, in order.
 *
 * The example's own record rather than the framework's: a stop hook runs after
 * the application is closed, so nothing can ask a route about it afterwards,
 * and the suite reads this instead.
 */
export const announcements: string[] = [];

/**
 * Announces its own start and stop. Nothing registers it and nothing names the
 * hooks: the framework reads them from this instance.
 */
@Injectable()
export class AppService implements OnModuleInit, OnApplicationShutdown {
  #started = false;

  onModuleInit(): void {
    this.#started = true;
    announcements.push("onModuleInit");
  }

  onApplicationShutdown(): void {
    announcements.push("onApplicationShutdown");
  }

  record(): { started: boolean } {
    return { started: this.#started };
  }
}
