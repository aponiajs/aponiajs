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

/** The storage contract a refresh-token service accepts. */
export interface RefreshTokenStore {
  create(record: RefreshTokenRecord): void | Promise<void>;
  find(idHash: string): RefreshTokenRecord | undefined | Promise<RefreshTokenRecord | undefined>;
  delete(idHash: string): boolean | Promise<boolean>;
  deleteFamily(familyId: string): number | Promise<number>;
  clear(): void | Promise<void>;
}
