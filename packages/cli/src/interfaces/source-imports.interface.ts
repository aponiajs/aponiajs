/**
 * How an import declaration binds the name it brings into a file.
 *
 * `named` is a `{ X }` clause, `default` is a default clause, and `namespace` is
 * an `* as X` clause. The distinction is recorded because a generated module has
 * to write the same form back: a namespace binding is a container whose members
 * cannot be imported individually, and a default binding has no exported name to
 * import.
 */
export type SourceImportForm = "named" | "default" | "namespace";

/**
 * Whether a binding may be read as a value or only as a type.
 *
 * A type-only binding cannot appear in a value position, so a generated module
 * has to import it with `import type` and may only use it in the type positions
 * the analysis found it in.
 */
export type SourceImportKind = "value" | "type";

/**
 * One name a source file can read, and the declaration it is bound to.
 *
 * Build-time generation only ever writes names a generated module can import, so
 * every name an expression reads is reduced to one of these records: what the
 * owning file calls it, what the exporting module calls it, where it comes from,
 * and how it is bound.
 *
 * `specifier` is the module specifier the owning file wrote — `"elysia"`,
 * `"@aponiajs/common"`, `"./users.service.ts"` — with a relative one already
 * resolved against the owning file's directory, so the record stays usable from
 * a generated file in a different location. A bare specifier is kept as written
 * because resolution is the toolchain's business, not this analysis's.
 *
 * A name the owning file declares and exports itself resolves the same way, with
 * the file's own path as the specifier, because a generated module imports it
 * from there like any other name.
 */
export interface SourceImport {
  /** The local name the owning file uses. */
  readonly name: string;
  /** The name the exporting module declares, which differs from `name` only for an aliased import. */
  readonly exportedName: string;
  /** The module specifier, or an absolute file path for a specifier that was resolved relative to the owner. */
  readonly specifier: string;
  readonly form: SourceImportForm;
  readonly kind: SourceImportKind;
}

/** Every name one source file can read, keyed by the local name it reads them under. */
export type SourceImports = ReadonlyMap<string, SourceImport>;

/**
 * What one expression reads from the file it was written in, or why a generated
 * module cannot reproduce it.
 *
 * `references` is reported even when the expression is unreadable, exactly as an
 * unreadable module entry keeps its source text: an omission would be
 * indistinguishable from an expression that reads nothing.
 */
export interface SourceImportsReading {
  /** The names the expression reads, in first-use order. */
  readonly references: readonly SourceImport[];
  /** Why the expression cannot be reproduced in a generated module, or `undefined` when it can. */
  readonly unreadable: string | undefined;
}
