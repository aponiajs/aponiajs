/**
 * The cross-origin policy an application declares, as the data a configuration
 * can carry.
 *
 * Every field here is a value an environment can supply: strings, booleans, and
 * numbers. That is the whole reason the type is not the wrapped plugin's own
 * `CORSConfig`: that type also accepts a `RegExp` or a `(request) => boolean`
 * function as `origin`, and code is not data, so the configuration seam cannot
 * carry it. What a configuration cannot express is stated in the README rather
 * than widened here.
 *
 * `origins` is required and non-empty. The wrapped plugin defaults its `origin`
 * to `true`, which reflects whatever `Origin` a request happens to carry, and
 * combining that with the plugin's own `credentials: true` default is a
 * response that lets any site read a credentialed API. Requiring the
 * application to name its origins, and defaulting `credentials` to `false`,
 * removes both permissive defaults rather than inheriting them.
 */
export interface CorsConfiguration {
  /**
   * The origins allowed to read a response, as exact origin strings.
   *
   * The list must be non-empty. `"*"` is accepted and means "every origin": the
   * wrapped plugin then answers `Access-Control-Allow-Origin: *`, which is a
   * statement an application makes deliberately rather than a default it gets.
   * A list that contains `"*"` may not be combined with `credentials: true`,
   * because a browser rejects `Access-Control-Allow-Origin: *` beside
   * `Access-Control-Allow-Credentials: true`; that combination is refused at
   * boot.
   */
  readonly origins: readonly string[];
  /**
   * The methods `Access-Control-Allow-Methods` states.
   *
   * Omitted means the wrapped plugin's own default, which echoes the method the
   * preflight asked about. When present the list must be non-empty.
   */
  readonly methods?: readonly string[];
  /**
   * The headers `Access-Control-Allow-Headers` states.
   *
   * Omitted means the wrapped plugin's own default, which echoes the headers the
   * request declared. When present the list must be non-empty.
   */
  readonly allowedHeaders?: readonly string[];
  /**
   * The headers `Access-Control-Expose-Headers` states.
   *
   * Omitted means the wrapped plugin's own default, which echoes the request's
   * own header names. When present the list must be non-empty.
   */
  readonly exposeHeaders?: readonly string[];
  /**
   * Whether a browser may send credentials with a cross-origin request.
   *
   * **Defaults to `false` here, where the wrapped plugin defaults it to `true`.**
   * That default is this adapter's own: a package that passed the plugin's
   * default through would ship `Access-Control-Allow-Credentials: true` on
   * every response, and a reader who paired it with a permissive origin would
   * have a credentialed API open to any site. An application that wants
   * credentialed requests states `true` — and must then name its origins
   * rather than using `"*"`.
   */
  readonly credentials?: boolean;
  /**
   * How long, in seconds, a browser may cache the preflight answer.
   *
   * Omitted means the wrapped plugin's own default of `5`. When present it must
   * be a non-negative number.
   */
  readonly maxAge?: number;
  /**
   * Whether the wrapped plugin answers `OPTIONS` preflight requests itself.
   *
   * Omitted means the wrapped plugin's own default of `true`. When present it
   * must be a boolean.
   */
  readonly preflight?: boolean;
}
