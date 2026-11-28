/** What a decorated method receives as its second argument. */
export interface McpContext {
  /** Which primitive is running. */
  readonly kind: "tool" | "resource" | "resourceTemplate" | "prompt";
  /** The tool or prompt name, or the resource's URI. */
  readonly name: string;
  /** The URI a resource read named, when there is one. */
  readonly uri?: string;
  /** The transport the call arrived on. */
  readonly transport: "http" | "stdio";
  /** The verified authentication information the caller supplied. */
  readonly authInfo?: unknown;
  /** The web-standard request, for an HTTP call. */
  readonly requestInfo?: Request;
  /** The platform's own request context, when the platform has one. */
  readonly request?: unknown;
  /** Aborted when the client cancels the call or goes away. */
  readonly signal?: AbortSignal;
  /** The SDK's request context, for the parts this package does not model. */
  readonly server?: unknown;
}
