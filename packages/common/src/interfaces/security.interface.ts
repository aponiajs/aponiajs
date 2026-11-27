/**
 * Extraction strategy or credential shape handled by security guards.
 */
export interface AuthGuardOptions {
  /** Optional custom token extractor from native Request or RouteContext */
  readonly defaultScheme?: string;
}

/**
 * Standard bearer token payload representation.
 */
export interface AuthenticatedUser {
  readonly id?: string | number;
  readonly roles?: readonly string[];
  readonly [key: string]: unknown;
}
