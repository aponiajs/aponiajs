import { createToken } from "@aponiajs/common";

/** Tokens name the dependencies that are not classes. */
export const APPLICATION_NAME = createToken<string>("APPLICATION_NAME");
export const GREETING_PREFIX = createToken<string>("GREETING_PREFIX");
export const REQUEST_BUDGET = createToken<number>("REQUEST_BUDGET");
