/** The stored form of one refresh token; the raw token is never stored. */
export interface RefreshTokenRecord {
  readonly idHash: string;
  readonly userId: string | number;
  readonly familyId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** The value `RefreshTokenService.issue` answers. */
export interface IssuedRefreshToken {
  readonly token: string;
  readonly userId: string | number;
  readonly familyId: string;
  readonly expiresAt: number;
}

/**
 * What an atomic consume answers.
 *
 * A live token answers its record; a token that was already consumed answers the
 * family it belonged to, which is what lets `rotate` revoke the family on reuse.
 */
export type RefreshTokenConsumeResult =
  | { readonly record: RefreshTokenRecord }
  | { readonly familyId: string };

/** The storage contract a refresh-token service accepts. */
export interface RefreshTokenStore {
  create(record: RefreshTokenRecord): void | Promise<void>;
  find(idHash: string): RefreshTokenRecord | undefined | Promise<RefreshTokenRecord | undefined>;
  delete(idHash: string): boolean | Promise<boolean>;
  deleteFamily(familyId: string): number | Promise<number>;
  clear(): void | Promise<void>;
  /**
   * Atomically consumes a token.
   *
   * Optional: a custom store without it falls back to `find` + `delete`, which
   * still lets exactly one concurrent rotation win but cannot detect reuse after
   * the record is gone. The built-in memory and Redis stores implement it.
   */
  consume?(
    idHash: string,
  ): RefreshTokenConsumeResult | undefined | Promise<RefreshTokenConsumeResult | undefined>;
}
