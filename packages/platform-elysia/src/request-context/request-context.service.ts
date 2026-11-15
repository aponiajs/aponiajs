import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@aponiajs/common";
import type { RequestContext } from "./request-context.types.ts";

/**
 * An injectable singleton service providing access to the current request's context store.
 */
@Injectable()
export class RequestContextService {
  readonly #storage: AsyncLocalStorage<RequestContext>;

  constructor(storage?: AsyncLocalStorage<RequestContext>) {
    this.#storage = storage ?? new AsyncLocalStorage<RequestContext>();
  }

  /**
   * Retrieves the context of the in-flight request being served, or `undefined` when called outside one.
   */
  current(): RequestContext | undefined {
    return this.#storage.getStore();
  }
}
