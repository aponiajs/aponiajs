/**
 * An exception Nest's framework itself throws and a filter may answer.
 *
 * The class exists so an application can distinguish an intrinsic framework
 * failure from its own exceptions without matching message text.
 */
export class IntrinsicException extends Error {
  constructor(message?: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
