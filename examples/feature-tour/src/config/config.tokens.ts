import { createToken } from "@aponiajs/common";

/** Use case: a token names a dependency that is not a class. */
export const APPLICATION_NAME = createToken<string>("APPLICATION_NAME");
export const GREETING_PREFIX = createToken<string>("GREETING_PREFIX");
export const REQUEST_BUDGET = createToken<number>("REQUEST_BUDGET");
