/** The page object an Inertia client reads. */
export interface InertiaPage<TProps extends Record<string, unknown> = Record<string, unknown>> {
  /** The front-end component name, such as `Users/Index`. */
  readonly component: string;
  /** The props the component receives. */
  readonly props: TProps;
  /** The URL that produced the page. */
  readonly url: string;
  /** The asset version the client compares before a full reload. */
  readonly version: string;
}

/** Options for rendering an Inertia page. */
export interface InertiaOptions {
  /** The asset version; defaults to the package-provided constant. */
  readonly version?: string;
  /** The root HTML document; `{{ inertia }}` receives the page payload. */
  readonly rootView?: string;
  /** Script tags appended to the root document. */
  readonly scripts?: readonly string[];
  /** Style tags appended to the root document. */
  readonly styles?: readonly string[];
}
