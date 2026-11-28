import { Inject } from "@aponiajs/common";

const defaultQueueName = "default";

/**
 * The token a named queue is injectable under.
 *
 * `@nestjs/bullmq` spells this `BullQueue_<name>`; this package names its
 * in-process queue registration instead, and never presents the token as a
 * broker queue.
 *
 * @param name - The registration's name; omitted is the default queue.
 * @returns The injection token.
 */
export function getQueueToken(name?: string): string {
  return `AponiaQueue_${name ?? defaultQueueName}`;
}

/**
 * Injects the in-process queue a registration provides.
 *
 * @param name - The registration's name; omitted is the default queue.
 * @returns The parameter decorator.
 */
export const InjectQueue = (name?: string): ReturnType<typeof Inject> =>
  Inject(getQueueToken(name));
