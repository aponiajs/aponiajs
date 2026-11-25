/**
 * A response body streamed from a buffer.
 *
 * Mirrors Nest's `StreamableFile`: the platform answers the bytes with the
 * headers `getHeaders()` states, and `getStream()` exposes a web stream for a
 * runtime that writes one. The serializer interceptor deliberately leaves a
 * `StreamableFile` alone.
 */
export interface StreamableFileOptions {
  /** The `Content-Type`; defaults to `application/octet-stream`. */
  readonly type?: string;
  /** The `Content-Disposition` value. */
  readonly disposition?: string;
  /** The `Content-Length`, when the caller knows it. */
  readonly length?: number;
}

/** A buffer the platform answers as a streamed response. */
export class StreamableFile {
  readonly #buffer: Uint8Array;
  readonly #options: StreamableFileOptions;

  /**
   * @param buffer - The bytes to send.
   * @param options - The response headers the bytes carry.
   */
  constructor(buffer: Uint8Array, options: StreamableFileOptions = {}) {
    this.#buffer = buffer;
    this.#options = Object.freeze({ ...options });
  }

  /** The bytes this file answers with. */
  getBuffer(): Uint8Array {
    return this.#buffer;
  }

  /** A web stream over the same bytes. */
  getStream(): ReadableStream<Uint8Array> {
    const buffer = this.#buffer;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buffer);
        controller.close();
      },
    });
  }

  /** The headers the response carries. */
  getHeaders(): Record<string, string> {
    return {
      "content-type": this.#options.type ?? "application/octet-stream",
      ...(this.#options.disposition === undefined
        ? {}
        : { "content-disposition": this.#options.disposition }),
      ...(this.#options.length === undefined
        ? {}
        : { "content-length": String(this.#options.length) }),
    };
  }

  /** The error the source reported, when one was captured. */
  getError(): Error | null {
    return null;
  }
}
