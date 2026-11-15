/**
 * The tracing policy an application declares, as the data a configuration can
 * carry.
 *
 * Every field here is a value an environment can supply: strings, booleans, and
 * lists of strings. That is the whole reason the type is not the wrapped
 * plugin's own `ElysiaOpenTelemetryOptions`: that type also accepts the span
 * processors, the instrumentations, the context manager, the check predicate,
 * and the rest of the `NodeSDK` options — all code or live objects, none of which
 * a configuration can carry. What a configuration cannot express is stated in
 * the README rather than widened here; the objects travel to `register` instead.
 *
 * `serviceName` is required. The wrapped plugin defaults it to `"Elysia"`, which
 * is a name a service would have to overwrite to be distinguishable from every
 * other service in a trace. Requiring the application to name its service
 * removes the default rather than inheriting it.
 */
export interface OpentelemetryConfiguration {
  /**
   * The service name every span this application exports carries, as
   * `service.name` on the resource.
   *
   * Required and non-empty. The wrapped plugin defaults it to `"Elysia"`, and
   * an empty string is not the same as omitting it — the default is applied only
   * to `undefined` — so both are refused here.
   */
  readonly serviceName: string;
  /**
   * Whether request and response bodies are recorded on spans.
   *
   * Omitted means the wrapped plugin's own default, which records no body
   * content. `true` records both sides; `{ request: true }` and
   * `{ response: true }` record one. Request bodies routinely carry credentials,
   * so this is the field the cross-field rule below is about.
   */
  readonly recordBody?: boolean | { readonly request?: boolean; readonly response?: boolean };
  /**
   * The HTTP header names captured as span attributes, by side.
   *
   * Omitted means the wrapped plugin's own default, which records no headers.
   * `"*"` captures every header on that side; including `"cookie"` on the
   * request side also emits `http.request.cookie`. Header values are data on an
   * exported span, so a credential-bearing name here is what the cross-field
   * rule below is about.
   */
  readonly headersToSpanAttributes?: {
    readonly request?: readonly string[];
    readonly response?: readonly string[];
  };
  /**
   * How server-side URL redaction is configured.
   *
   * Omitted means the wrapped plugin's own default, which redacts `userinfo` and
   * its default set of sensitive query parameters. `false` records URLs raw,
   * which the wrapped plugin documents as able to leak secrets carried in a
   * query string or in credentials; it is accepted here as the deliberate
   * choice it is, and stated in the README as the one setting this package
   * cannot make safe for a reader.
   */
  readonly spanUrlRedaction?:
    | false
    | {
        readonly stripCredentials?: boolean;
        readonly sensitiveQueryParams?: readonly string[];
      };
}
