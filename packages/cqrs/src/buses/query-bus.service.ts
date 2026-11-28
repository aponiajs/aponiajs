import { AponiaError, Injectable, type ClassToken } from "@aponiajs/common";
import type { IQuery, IQueryHandler } from "../interfaces/cqrs.interface.ts";

/**
 * Dispatches queries to their registered `@QueryHandler()` implementation.
 */
@Injectable()
export class QueryBus<TQueryBase extends IQuery = IQuery> {
  readonly #handlers = new Map<ClassToken<unknown>, IQueryHandler<TQueryBase, unknown>>();

  /** Registers a query handler instance for `queryType`. */
  registerHandler(
    queryType: ClassToken<unknown>,
    handler: IQueryHandler<TQueryBase, unknown>,
  ): void {
    this.#handlers.set(queryType, handler);
  }

  /**
   * Executes `query` by invoking its registered handler.
   *
   * @throws `AponiaError` (`MISSING_PROVIDER`) when no handler is registered for the query.
   */
  async execute<TResult = unknown>(query: TQueryBase): Promise<TResult> {
    const queryType = (query as unknown as { constructor: ClassToken<unknown> }).constructor;
    const handler = this.#handlers.get(queryType);
    if (handler === undefined) {
      throw new AponiaError(
        "MISSING_PROVIDER",
        `No query handler registered for "${queryType.name}".`,
        { query: queryType.name },
      );
    }
    return (await handler.execute(query)) as TResult;
  }
}
