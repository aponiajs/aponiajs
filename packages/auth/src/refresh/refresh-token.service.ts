import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AponiaError } from "@aponiajs/common";
import type { RefreshOptions } from "../module/auth.types.ts";
import type {
  IssuedRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
} from "./refresh-token.types.ts";

const defaultTtlMs = 30 * 24 * 60 * 60 * 1_000;

/** Issues, rotates, and revokes opaque refresh tokens. */
export class RefreshTokenService {
  readonly #store: RefreshTokenStore;
  readonly #ttlMs: number;
  readonly #now: () => number;

  /** @internal Construct through `AuthModule.register`. */
  constructor(store: RefreshTokenStore, options: RefreshOptions = {}) {
    const ttlMs = options.ttlMs ?? defaultTtlMs;
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new AponiaError("INVALID_AUTH_OPTIONS", "refresh.ttlMs must be a positive integer.");
    }
    this.#store = store;
    this.#ttlMs = ttlMs;
    this.#now = options.now ?? Date.now;
  }

  /** Issues one token, optionally in an existing rotation family. */
  async issue(
    userId: string | number,
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString("base64url");
    const now = this.#now();
    const record: RefreshTokenRecord = Object.freeze({
      idHash: hashToken(token),
      userId,
      familyId,
      createdAt: now,
      expiresAt: now + this.#ttlMs,
    });
    await this.#store.create(record);
    return Object.freeze({ token, userId, familyId, expiresAt: record.expiresAt });
  }

  /** Rotates one token; the old token is consumed before the new one is issued. */
  async rotate(token: string): Promise<IssuedRefreshToken> {
    const idHash = hashToken(token);
    const record = await this.#store.find(idHash);
    if (record === undefined) {
      throw invalidRefreshToken();
    }
    await this.#store.delete(idHash);
    return await this.issue(record.userId, record.familyId);
  }

  /** Revokes one token. */
  async revoke(token: string): Promise<boolean> {
    return await this.#store.delete(hashToken(token));
  }

  /** Revokes every token in a rotation family. */
  async revokeFamily(familyId: string): Promise<number> {
    return await this.#store.deleteFamily(familyId);
  }

  /** Clears the store. */
  async clear(): Promise<void> {
    await this.#store.clear();
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function invalidRefreshToken(): AponiaError {
  return new AponiaError(
    "INVALID_REFRESH_TOKEN",
    "The refresh token is invalid, expired, or already used.",
  );
}
