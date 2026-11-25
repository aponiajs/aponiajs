/**
 * The base class every built-in HTTP exception extends.
 *
 * Mirrors Nest's `HttpException`: the response body a caller states (a string,
 * an object, or a description wrapped in one), the status the platform answers
 * with, and an optional cause. The platform-neutral `HttpError` in
 * `@aponiajs/platform-core` remains the RFC 9457 subclass; this class is the
 * authoring surface a Nest application imports.
 */
export class HttpException extends Error {
  readonly #response: string | object;
  readonly #status: number;

  /**
   * @param response - The body to answer with, or the message a description wraps.
   * @param status - The numeric HTTP status.
   * @param options - An optional cause and description.
   */
  constructor(
    response: string | object,
    status: number,
    options: { readonly cause?: unknown; readonly description?: string } = {},
  ) {
    super();
    this.#response = response;
    this.#status = status;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    this.initMessage(options.description);
    this.initName();
  }

  /** The body this exception answers with. */
  getResponse(): string | object {
    return this.#response;
  }

  /** The numeric HTTP status, exposed for a platform that reads a `status`. */
  get status(): number {
    return this.#status;
  }

  /** The numeric HTTP status this exception answers with. */
  getStatus(): number {
    return this.#status;
  }

  /**
   * The JSON response a platform that calls `toResponse()` answers with.
   *
   * The body is the declared response when it is an object, and a Nest-shaped
   * `{ statusCode, message, error }` when the declaration was a string. No
   * stack and no cause are included.
   */
  toResponse(): Response {
    const body =
      typeof this.#response === "object"
        ? this.#response
        : {
            statusCode: this.#status,
            message: this.#response,
            error: this.name,
          };
    return new Response(JSON.stringify(body), {
      status: this.#status,
      headers: { "content-type": "application/json" },
    });
  }

  /**
   * Records the message a reader sees on the thrown error.
   *
   * A string response is the message; an object carrying `message` or `error`
   * lends that value; anything else states the class name so the thrown error
   * is never blank.
   */
  initMessage(description?: string): void {
    if (typeof this.#response === "string") {
      this.message = this.#response;
      return;
    }
    const body = this.#response as { readonly message?: unknown; readonly error?: unknown };
    const message = body.message ?? body.error ?? description;
    if (typeof message === "string") {
      this.message = message;
      return;
    }
    if (Array.isArray(message)) {
      this.message = message.map(String).join(", ");
      return;
    }
    this.message = this.constructor.name;
  }

  /** Names the thrown value after the class that was actually thrown. */
  initName(): void {
    this.name = this.constructor.name;
  }

  /** A short rendering, as Nest's own exceptions provide. */
  override toString(): string {
    return `${this.name}: ${this.message}`;
  }
}
