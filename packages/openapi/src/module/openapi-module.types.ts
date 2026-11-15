import type { ConfigurationToken } from "@aponiajs/common";
import type { OpenApiConfiguration } from "../document/openapi-document.types.ts";

/**
 * How an application declares the document in its `imports`.
 *
 * The metadata arrives through `configuration` rather than as an options
 * object, and that is the contract this package exists to add: a validated
 * configuration turns a missing title or a blank version into a refused boot
 * with a code and an issue list, where a loose object literal reaches the
 * plugin and becomes a document that says whatever the value happened to hold.
 */
export interface OpenApiModuleOptions {
  /**
   * The declaration whose value states the document's own metadata.
   *
   * The module provides this token itself, from the environment unless `source`
   * says otherwise, and exports it, so the same validated value is both what
   * the document carries and what the application can inject. It is a
   * `defineConfiguration` result rather than a schema, because the token is
   * what the container keys the value by and the schema alone has no identity a
   * graph could resolve.
   */
  readonly configuration: ConfigurationToken<OpenApiConfiguration>;
  /**
   * The record the configuration's schema validates, instead of `process.env`.
   *
   * Present for the same reason `provideConfiguration` accepts it: a literal is
   * how a test — or an application reading a file rather than its environment —
   * validates without mutating the process. Omitting it reads the environment,
   * which is what an application in production wants and what a test must not
   * get.
   */
  readonly source?: Readonly<Record<string, unknown>>;
  /**
   * The module's stable identity, which is what the graph keys the registration
   * by.
   *
   * Two registrations under one key are one module identity, which the graph
   * refuses as a duplicate rather than mounting one and dropping the other.
   * Defaults to `"openapi"`.
   *
   * A distinct key does not buy a second document. Elysia mounts a named plugin
   * once, and the wrapped plugin is named, so an application that declares two
   * registrations under distinct keys gets two graph nodes and one document —
   * the one whose registration mounted first — while the second path answers
   * `404`. One registration per application is the supported shape.
   */
  readonly key?: string;
  /**
   * Where the document is served, as an absolute path.
   *
   * Two routes are mounted: this path, which serves the documentation UI the
   * wrapped plugin provides, and `<path>/json`, which serves the document
   * itself. Defaults to `"/openapi"`.
   *
   * A path that is not an absolute path is refused with a `TypeError` while the
   * registration runs. That is deliberate and different from a configuration
   * refusal: the metadata is data an environment can get wrong, so it is
   * validated with an error code and an issue list, while a mount path is
   * written in source and a wrong one is a mistake in the declaration itself.
   */
  readonly path?: string;
}
