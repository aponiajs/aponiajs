import type { RevocationStore } from "./revocation.types.ts";

/** Checks whether an access token's `jti` was revoked. */
export class RevocationService {
  readonly #store: RevocationStore;

  /** @internal Construct through `AuthModule.register`. */
  constructor(store: RevocationStore) {
    this.#store = store;
  }

  /** Revokes one `jti` until its token expiry. */
  async revoke(jti: string, expiresAt: number): Promise<void> {
    await this.#store.revoke(jti, expiresAt);
  }

  /** Whether the token's `jti` is currently revoked. */
  async isRevoked(jti: string): Promise<boolean> {
    return await this.#store.isRevoked(jti);
  }

  /** Clears the revocation set. */
  async clear(): Promise<void> {
    await this.#store.clear();
  }
}
