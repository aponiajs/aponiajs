import { createToken } from "@aponiajs/common";
import type { OnApplicationShutdown } from "@aponiajs/common";

/** The interface the token fixtures replace, so a substitute is type-checked. */
export interface Greeter {
  greet(name: string): string;
}

/** Two tokens of one type, which is what an alias override needs. */
export const PRIMARY_GREETER = createToken<Greeter>("primary-greeter");
export const SECONDARY_GREETER = createToken<Greeter>("secondary-greeter");

/** A token no fixture module provides, so an override naming it must be refused. */
export const ABSENT_GREETER = createToken<Greeter>("absent-greeter");

/** A provider with no dependencies, so it needs no decorator to carry metadata. */
export class GreetingService implements Greeter {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

/** A substitute the `useClass` and `useFactory` cases construct or return. */
export class LoudGreetingService implements Greeter {
  greet(name: string): string {
    return `HELLO, ${name}!`;
  }
}

/**
 * Records how often the application stopped it.
 *
 * It is a provider, so a case can read the count back through the container
 * after `close()` and state that the stopping hooks ran exactly once.
 */
export class ShutdownProbe implements OnApplicationShutdown {
  shutdowns = 0;

  onApplicationShutdown(): void {
    this.shutdowns += 1;
  }
}
