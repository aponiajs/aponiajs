/**
 * `@aponiajs/security` — secure response headers and CSRF protection.
 *
 * Headers are enabled with conservative defaults. CSRF is opt-in and uses a
 * signed double-submit token: the cookie is readable by the application's own
 * client, and every unsafe request must echo the token in a header.
 */
export { SecurityModule } from "./module/security-module.ts";
export { getCspNonce } from "./policy/security-policy.ts";
export type {
  CsrfOptions,
  SecurityHeadersOptions,
  SecurityModuleOptions,
} from "./module/security.types.ts";
