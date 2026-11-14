import { AponiaError } from "@aponiajs/common";
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import { mapVerifiedClaims } from "../authentication/claims.ts";
import type { AuthUser } from "../module/auth.types.ts";
import type { OidcOptions, OidcProviderMetadata, ResolvedOidcOptions } from "./oidc.types.ts";

const defaultAlgorithms = Object.freeze(["RS256", "PS256", "ES256"]);

/** Verifies access tokens against an OpenID Connect provider's published keys. */
export class OidcService {
  readonly #options: ResolvedOidcOptions;
  #metadata: Promise<OidcProviderMetadata> | undefined;
  #keys: ReturnType<typeof createRemoteJWKSet> | undefined;

  /** @internal Construct through `AuthModule.register`. */
  constructor(options: OidcOptions) {
    this.#options = resolveOptions(options);
  }

  /** Reads and validates the provider's discovery document. */
  async discover(): Promise<OidcProviderMetadata> {
    this.#metadata ??= this.#readMetadata();
    try {
      return await this.#metadata;
    } catch (error) {
      this.#metadata = undefined;
      throw error;
    }
  }

  /** Verifies one token against the provider's key set. */
  async verify(token: string): Promise<AuthUser> {
    const metadata = await this.discover();
    const keys = (this.#keys ??= createRemoteJWKSet(new URL(metadata.jwks_uri), {
      timeoutDuration: this.#options.timeoutMs,
      [customFetch]: this.#options.fetch,
    }));
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: this.#options.issuer,
        ...(this.#options.audience === undefined ? {} : { audience: this.#options.audience }),
        algorithms: [...this.#options.algorithms],
        clockTolerance: this.#options.clockTolerance,
      }));
    } catch {
      throw new AponiaError(
        "INVALID_AUTH_TOKEN",
        "The authentication token is invalid or expired.",
      );
    }
    return mapVerifiedClaims(payload);
  }

  /** Drops the cached discovery document and key set. */
  clear(): void {
    this.#metadata = undefined;
    this.#keys = undefined;
  }

  async #readMetadata(): Promise<OidcProviderMetadata> {
    const { discoveryUrl, timeoutMs, fetch } = this.#options;
    let response: Response;
    try {
      response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw discoveryFailed(discoveryUrl, "the request failed");
    }
    if (!response.ok) {
      throw discoveryFailed(discoveryUrl, `it answered ${response.status}`);
    }
    let document: unknown;
    try {
      document = await response.json();
    } catch {
      throw discoveryFailed(discoveryUrl, "the body is not JSON");
    }
    return Object.freeze(validateMetadata(document, this.#options.issuer, discoveryUrl));
  }
}

function resolveOptions(options: OidcOptions): ResolvedOidcOptions {
  if (typeof options.issuer !== "string" || options.issuer.trim() === "") {
    throw invalid("oidc.issuer must be a non-empty string");
  }
  if (options.audience !== undefined && options.audience.trim() === "") {
    throw invalid("oidc.audience must be a non-empty string when present");
  }
  const algorithms = options.algorithms ?? defaultAlgorithms;
  if (
    !Array.isArray(algorithms) ||
    algorithms.length === 0 ||
    algorithms.some((algorithm) => typeof algorithm !== "string" || algorithm.trim() === "")
  ) {
    throw invalid("oidc.algorithms must be a non-empty array of strings");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw invalid("oidc.timeoutMs must be a positive integer");
  }
  const clockTolerance = options.clockTolerance ?? 30;
  if (!Number.isFinite(clockTolerance) || clockTolerance < 0) {
    throw invalid("oidc.clockTolerance must be a non-negative number");
  }
  const discoveryUrl =
    options.discoveryUrl ??
    `${options.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  if (!isHttpUrl(discoveryUrl)) {
    throw invalid("oidc.discoveryUrl must be an absolute http or https URL");
  }
  return Object.freeze({
    issuer: options.issuer,
    audience: options.audience,
    algorithms: Object.freeze([...algorithms]),
    discoveryUrl,
    timeoutMs,
    clockTolerance,
    fetch: options.fetch ?? globalThis.fetch,
  });
}

function validateMetadata(
  document: unknown,
  issuer: string,
  discoveryUrl: string,
): OidcProviderMetadata {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw discoveryFailed(discoveryUrl, "the body is not an object");
  }
  const record = document as Record<string, unknown>;
  if (record.issuer !== issuer) {
    throw discoveryFailed(discoveryUrl, "it names a different issuer");
  }
  if (typeof record.jwks_uri !== "string" || !isHttpUrl(record.jwks_uri)) {
    throw discoveryFailed(discoveryUrl, "it states no usable jwks_uri");
  }
  return record as OidcProviderMetadata;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function discoveryFailed(url: string, reason: string): AponiaError {
  return new AponiaError(
    "OIDC_DISCOVERY_FAILED",
    `The OIDC discovery document could not be read: ${reason}.`,
    Object.freeze({ url }),
  );
}

function invalid(issue: string): AponiaError {
  return new AponiaError("INVALID_AUTH_OPTIONS", `The auth registration is invalid: ${issue}.`, {
    issues: Object.freeze([issue]),
  });
}
