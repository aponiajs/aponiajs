import { randomUUID } from "node:crypto";
import { AponiaError } from "@aponiajs/common";
import { SignJWT, decodeProtectedHeader, jwtVerify } from "jose";
import { mapVerifiedClaims } from "../authentication/claims.ts";
import type { AuthVerifier } from "../authentication/token-verifier.types.ts";
import type { AuthUser, ResolvedJwtOptions } from "../module/auth.types.ts";

/** The JWT verifier and signer an application injects. */
export class JwtService implements AuthVerifier {
  readonly #key: Uint8Array;
  readonly #rotation: ReadonlyMap<string, Uint8Array>;
  readonly #active: { readonly kid: string; readonly key: Uint8Array } | undefined;
  readonly #options: ResolvedJwtOptions;

  /** @internal Construct through `AuthModule.register`. */
  constructor(options: ResolvedJwtOptions) {
    const encoder = new TextEncoder();
    this.#key = encoder.encode(options.secret);
    this.#rotation = new Map(
      (options.keys ?? []).map((key) => [key.kid, encoder.encode(key.secret)] as const),
    );
    const activeKid = options.activeKid ?? options.keys?.[0]?.kid;
    this.#active =
      activeKid === undefined
        ? undefined
        : { kid: activeKid, key: this.#rotation.get(activeKid) as Uint8Array };
    this.#options = options;
  }

  /**
   * Signs one claims object.
   *
   * An access token needs a `jti` for revocation to reach it, so one is minted
   * when the caller did not supply a non-empty string. A caller-supplied `jti`
   * is preserved, which keeps deterministic test tokens and application-owned
   * identifiers working.
   */
  async sign(claims: Record<string, unknown>, expiresIn?: string | number): Promise<string> {
    const jti = typeof claims.jti === "string" && claims.jti !== "" ? claims.jti : randomUUID();
    const token = new SignJWT({ ...claims, jti })
      .setProtectedHeader(
        this.#active === undefined ? { alg: "HS256" } : { alg: "HS256", kid: this.#active.kid },
      )
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(expiresIn ?? this.#options.expiresIn);
    if (this.#options.issuer !== undefined) {
      token.setIssuer(this.#options.issuer);
    }
    if (this.#options.audience !== undefined) {
      token.setAudience(this.#options.audience);
    }
    return await token.sign(this.#active?.key ?? this.#key);
  }

  /** Verifies one token and answers its user claims. */
  async verify(token: string): Promise<AuthUser> {
    try {
      const options = {
        ...(this.#options.issuer === undefined ? {} : { issuer: this.#options.issuer }),
        ...(this.#options.audience === undefined ? {} : { audience: this.#options.audience }),
        algorithms: [...this.#options.algorithms],
      };
      const kid = readKeyId(token);
      if (kid !== undefined) {
        const key = this.#rotation.get(kid);
        if (key === undefined) {
          throw new AponiaError(
            "INVALID_AUTH_TOKEN",
            "The authentication token is invalid or expired.",
          );
        }
        const { payload } = await jwtVerify(token, key, options);
        return mapVerifiedClaims(payload);
      }
      const keys = [this.#key, ...this.#rotation.values()];
      let lastError: unknown;
      for (const key of keys) {
        try {
          const { payload } = await jwtVerify(token, key, options);
          return mapVerifiedClaims(payload);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("No key accepted the token.");
    } catch {
      throw new AponiaError(
        "INVALID_AUTH_TOKEN",
        "The authentication token is invalid or expired.",
      );
    }
  }
}

function readKeyId(token: string): string | undefined {
  try {
    const header = decodeProtectedHeader(token);
    return typeof header.kid === "string" && header.kid !== "" ? header.kid : undefined;
  } catch {
    return undefined;
  }
}
