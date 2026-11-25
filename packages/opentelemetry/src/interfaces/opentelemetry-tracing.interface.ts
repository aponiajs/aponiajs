/**
 * The tracing policy an application declares, as the data a configuration can
 * carry.
 *
 * Every field is a value an environment can supply. The live objects a tracer
 * needs — span processors, instrumentations, a sampler — are module options,
 * not configuration fields.
 */
export interface OpentelemetryConfiguration {
  /** The `service.name` resource attribute every span carries. */
  readonly serviceName: string;
  /** Whether the request and response bodies are recorded on the span. */
  readonly recordBody?: boolean | { readonly request?: boolean; readonly response?: boolean };
  /** Header names copied onto the span, per direction. */
  readonly headersToSpanAttributes?: {
    readonly request?: readonly string[];
    readonly response?: readonly string[];
  };
  /**
   * How a URL is stated on a span. `false` records it raw; omitted strips
   * credentials and the sensitive query parameters the policy names.
   */
  readonly spanUrlRedaction?:
    | false
    | {
        readonly stripCredentials?: boolean;
        readonly sensitiveQueryParams?: readonly string[];
      };
}
