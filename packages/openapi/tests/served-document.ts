/**
 * The parts of a served document the OpenAPI cases read.
 *
 * A narrowed reading rather than the whole document, because the rest of it is
 * `@elysia/openapi`'s own lowering and a snapshot of it would fail on a plugin
 * release that changed nothing this package promises.
 *
 * A `.ts` file rather than a `.types.ts` one, because it sits in the test lane
 * rather than in a package's `src/` owner directory, where the layout guard looks
 * for that suffix.
 */

/** One parameter, read as far as the cases below assert it. */
export interface ServedParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly schema?: unknown;
}

/** One operation, read as far as the cases below assert it. */
export interface ServedOperation {
  readonly operationId?: string;
  readonly parameters?: readonly ServedParameter[];
  readonly requestBody?: {
    readonly content: Readonly<Record<string, { readonly schema: unknown }>>;
  };
  readonly responses?: Readonly<
    Record<string, { readonly content?: Readonly<Record<string, { readonly schema: unknown }>> }>
  >;
}

/** A document, read as far as the cases below assert it. */
export interface ServedDocument {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly paths: Readonly<Record<string, Readonly<Record<string, ServedOperation>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
}
