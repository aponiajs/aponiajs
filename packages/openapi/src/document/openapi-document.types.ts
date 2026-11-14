/**
 * What the served document says about itself.
 *
 * The three fields are the ones OpenAPI's own Info Object names, and they are
 * the whole of what this package reads from a configuration. The rest of the
 * document — the paths, the operations, the schemas — is not configuration
 * data: it is what the platform compiled from the routes the application
 * declared, and a value an operator could edit would be a document describing
 * routes the application does not have.
 *
 * `title` and `version` are required because OpenAPI requires them: a document
 * without either is one a validator refuses, and an adapter that let the
 * wrapped plugin's placeholder stand in for them would serve a document
 * claiming a title the application never declared.
 */
export interface OpenApiInfo {
  /**
   * The document's title, and the name a reader meets in a generated client.
   *
   * Must be a non-empty string. A title the configuration left blank is
   * refused at boot rather than served as an empty heading.
   */
  readonly title: string;
  /**
   * The version of the API this document describes.
   *
   * OpenAPI's `info.version` is the version of the described API, not of the
   * framework or the package — an application states its own.
   */
  readonly version: string;
  /**
   * One or two sentences about the API, when the application has them to give.
   *
   * The one optional field. When the configuration states none, the served
   * document carries no description rather than a placeholder: the wrapped
   * plugin defaults this field to `"Development documentation"`, and letting
   * that stand would put a sentence in the document that no declaration in the
   * application supports.
   */
  readonly description?: string;
}

/**
 * The value an application's configuration validates into: the metadata the
 * served document carries.
 *
 * The metadata sits under `info` rather than at the top level, and that is the
 * same choice `CronConfiguration` makes with `jobs`: the key is where a later,
 * additive option on the document finds a home — a `servers` list, a `tags`
 * list — without a breaking change to the value's shape, and it is what lets
 * the guard's refusal name `"info"` rather than report that the whole value is
 * the wrong type.
 *
 * Nothing about the paths, the operations, or the schemas is here. Those are
 * the platform's lowering of the application's own declarations; a document
 * whose paths came from a configuration would be a document about routes
 * nothing answers.
 */
export interface OpenApiConfiguration {
  readonly info: OpenApiInfo;
}
