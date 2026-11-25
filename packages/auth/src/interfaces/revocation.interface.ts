/** The storage contract a revocation service accepts. */
export interface RevocationStore {
  revoke(jti: string, expiresAt: number): void | Promise<void>;
  isRevoked(jti: string): boolean | Promise<boolean>;
  clear(): void | Promise<void>;
}
