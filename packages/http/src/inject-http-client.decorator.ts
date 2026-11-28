import { Inject } from "@aponiajs/common";
import { getHttpClientToken } from "./http.module-definition.ts";

/**
 * Injects one registered client.
 *
 * `@InjectHttpClient('github')` resolves the client `register({ name: 'github' })`
 * created; without a name it resolves the default client, the same token as
 * typing the parameter as `HttpClient`.
 *
 * @param name - The client name; omitted means the default client.
 * @returns The parameter decorator.
 */
export const InjectHttpClient = (name?: string): ReturnType<typeof Inject> =>
  Inject(getHttpClientToken(name));
