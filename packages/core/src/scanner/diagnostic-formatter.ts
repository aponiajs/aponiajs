/**
 * Context provided to format actionable dependency injection diagnostics.
 */
export interface DiagnosticContext {
  /** The token name that could not be resolved. */
  readonly token: string;
  /** The module attempting to resolve the token. */
  readonly requestingModule: string;
  /** The module declaring the token, if any module declares it. */
  readonly declaringModule?: string;
  /** Whether the declaring module is imported by the requesting module. */
  readonly isImported?: boolean;
  /** Whether the declaring module exports the token. */
  readonly isExported?: boolean;
}

/**
 * Formats a Rust-style actionable diagnostic for a missing provider error,
 * including a header, diagnosis, and copy-paste quick fix code snippet.
 *
 * @param ctx - The diagnostic context describing the missing token and modules.
 * @returns The formatted diagnostic message string.
 */
export function formatMissingProviderDiagnostic(ctx: DiagnosticContext): string {
  const header = `[Aponia DI Error] MISSING_PROVIDER: Cannot resolve dependency "${ctx.token}" in "${ctx.requestingModule}".\n`;

  if (ctx.declaringModule && ctx.isImported && !ctx.isExported) {
    return (
      header +
      `\nDiagnosis:\n  "${ctx.token}" is declared in "${ctx.declaringModule}", and "${ctx.requestingModule}" imports "${ctx.declaringModule}",\n` +
      `  but "${ctx.declaringModule}" does not export "${ctx.token}".\n\n` +
      `Quick Fix:\n  Add "${ctx.token}" to the exports array in ${ctx.declaringModule}:\n` +
      `     @Module({\n` +
      `       providers: [${ctx.token}],\n` +
      `  +    exports: [${ctx.token}],\n` +
      `     })`
    );
  }

  if (ctx.declaringModule && !ctx.isImported) {
    return (
      header +
      `\nDiagnosis:\n  "${ctx.token}" is declared in "${ctx.declaringModule}", but "${ctx.requestingModule}" does not import "${ctx.declaringModule}".\n\n` +
      `Quick Fix:\n  Import "${ctx.declaringModule}" into "${ctx.requestingModule}":\n` +
      `     @Module({\n` +
      `  +    imports: [${ctx.declaringModule}],\n` +
      `     })`
    );
  }

  return (
    header +
    `\nDiagnosis:\n  Token "${ctx.token}" is not declared in any module in the dependency graph.\n\n` +
    `Quick Fix:\n  Provide "${ctx.token}" in "${ctx.requestingModule}":\n` +
    `     @Module({\n` +
    `  +    providers: [${ctx.token}],\n` +
    `     })`
  );
}
