import { describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { decodeJwt } from "jose";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  AuthGuard,
  AuthModule,
  JwtService,
  MemoryRefreshTokenStore,
  MemoryRevocationStore,
  Public,
  RefreshTokenService,
  RevocationService,
  type RefreshTokenStore,
} from "../src/index.ts";

describe("RefreshTokenService", () => {
  test("issues an opaque token that rotates into the same family", async () => {
    const service = new RefreshTokenService(new MemoryRefreshTokenStore(), { ttlMs: 60_000 });
    const issued = await service.issue("ada");

    expect(issued.userId).toBe("ada");
    expect(issued.token).not.toContain("ada");
    expect(issued.expiresAt).toBeGreaterThan(Date.now());

    const rotated = await service.rotate(issued.token);

    expect(rotated.userId).toBe("ada");
    expect(rotated.familyId).toBe(issued.familyId);
    expect(rotated.token).not.toBe(issued.token);

    const second = await service.rotate(rotated.token);
    expect(second.familyId).toBe(issued.familyId);
  });

  test("refuses a token that was already rotated", async () => {
    const service = new RefreshTokenService(new MemoryRefreshTokenStore());
    const issued = await service.issue(7);
    await service.rotate(issued.token);

    const error = await reject(service.rotate(issued.token));

    expect(error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("reuse of a consumed token revokes the whole family", async () => {
    const service = new RefreshTokenService(new MemoryRefreshTokenStore(), { ttlMs: 60_000 });
    const issued = await service.issue("ada");
    const rotated = await service.rotate(issued.token);

    expect((await reject(service.rotate(issued.token))).code).toBe("INVALID_REFRESH_TOKEN");
    // Reuse detection revokes the family, so the replacement no longer rotates.
    expect((await reject(service.rotate(rotated.token))).code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("a store without consume falls back to find and delete", async () => {
    const base = new MemoryRefreshTokenStore();
    const store: RefreshTokenStore = {
      create: (record) => base.create(record),
      find: (idHash) => base.find(idHash),
      delete: (idHash) => base.delete(idHash),
      deleteFamily: (familyId) => base.deleteFamily(familyId),
      clear: () => base.clear(),
    };
    const service = new RefreshTokenService(store, { ttlMs: 60_000 });
    const issued = await service.issue("ada");
    const rotated = await service.rotate(issued.token);

    expect((await reject(service.rotate(issued.token))).code).toBe("INVALID_REFRESH_TOKEN");
    // No tombstone without consume, so the replacement still rotates.
    expect((await service.rotate(rotated.token)).familyId).toBe(issued.familyId);
  });

  test("concurrent rotations produce exactly one winner", async () => {
    const service = new RefreshTokenService(new MemoryRefreshTokenStore(), { ttlMs: 60_000 });
    const issued = await service.issue("ada");

    const results = await Promise.allSettled([
      service.rotate(issued.token),
      service.rotate(issued.token),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as AponiaError).code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("refuses an unknown token and an expired token", async () => {
    let now = 1_000;
    const service = new RefreshTokenService(new MemoryRefreshTokenStore({ now: () => now }), {
      ttlMs: 1_000,
      now: () => now,
    });
    const issued = await service.issue("ada");

    expect((await reject(service.rotate("not-a-token"))).code).toBe("INVALID_REFRESH_TOKEN");

    now += 1_000;
    expect((await reject(service.rotate(issued.token))).code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("revokes one token or a whole family", async () => {
    const service = new RefreshTokenService(new MemoryRefreshTokenStore());
    const first = await service.issue("ada");
    const rotated = await service.rotate(first.token);
    const sibling = await service.issue("ada");

    expect(await service.revoke(rotated.token)).toBe(true);
    expect(await service.revoke(rotated.token)).toBe(false);
    expect((await reject(service.rotate(rotated.token))).code).toBe("INVALID_REFRESH_TOKEN");
    expect((await service.rotate(sibling.token)).familyId).toBe(sibling.familyId);

    const familyToken = await service.issue("ada");
    const next = await service.rotate(familyToken.token);
    expect(await service.revokeFamily(next.familyId)).toBe(1);
    expect((await reject(service.rotate(next.token))).code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("clears the store", async () => {
    const service = new RefreshTokenService(new MemoryRefreshTokenStore());
    const issued = await service.issue("ada");

    await service.clear();

    expect((await reject(service.rotate(issued.token))).code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("validates its options", () => {
    expect(
      capture(() => new RefreshTokenService(new MemoryRefreshTokenStore(), { ttlMs: 0 })).code,
    ).toBe("INVALID_AUTH_OPTIONS");
    expect(capture(() => new MemoryRefreshTokenStore({ maxTokens: 0 })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
  });

  test("keeps the in-memory store bounded", async () => {
    const store = new MemoryRefreshTokenStore({ maxTokens: 1 });
    store.create({
      idHash: "a",
      userId: "ada",
      familyId: "f",
      createdAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });
    store.create({
      idHash: "b",
      userId: "ada",
      familyId: "f",
      createdAt: 2,
      expiresAt: Number.MAX_SAFE_INTEGER,
    });

    expect(store.find("a")).toBeUndefined();
    expect(store.find("b")?.idHash).toBe("b");
    expect(store.delete("b")).toBe(true);
    expect(store.find("b")).toBeUndefined();
  });
});

describe("RevocationService", () => {
  test("revokes until expiry, then forgets the entry", async () => {
    let now = 10;
    const service = new RevocationService(new MemoryRevocationStore({ now: () => now }));

    await service.revoke("token-1", 100);
    expect(await service.isRevoked("token-1")).toBe(true);
    expect(await service.isRevoked("token-2")).toBe(false);

    now = 100;
    expect(await service.isRevoked("token-1")).toBe(false);
  });

  test("clears the revocation set and validates its options", async () => {
    const service = new RevocationService(new MemoryRevocationStore());
    await service.revoke("token-1", Number.MAX_SAFE_INTEGER);

    await service.clear();

    expect(await service.isRevoked("token-1")).toBe(false);
    expect(capture(() => new MemoryRevocationStore({ maxEntries: 0 })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
  });

  test("keeps the in-memory set bounded", async () => {
    const store = new MemoryRevocationStore({ maxEntries: 1 });
    store.revoke("one", Number.MAX_SAFE_INTEGER);
    store.revoke("two", Number.MAX_SAFE_INTEGER);

    expect(store.isRevoked("one")).toBe(false);
    expect(store.isRevoked("two")).toBe(true);
  });
});

describe("revocation during authentication", () => {
  let application: AponiaApplication | undefined;

  test("refuses an access token whose jti was revoked", async () => {
    @Controller("secured")
    @UseGuards(AuthGuard)
    class SecuredController {
      @Public()
      @Get("open")
      open(): string {
        return "open";
      }

      @Get("me")
      me(): string {
        return "me";
      }
    }

    @Module({
      imports: [AuthModule.register({ jwt: { secret: "x".repeat(32) } })],
      controllers: [SecuredController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const jwt = application.get(JwtService);
      const token = await jwt.sign({ sub: "ada", jti: "access-1" });
      const headers = { authorization: `Bearer ${token}` };

      expect(
        await (
          await application.handle(new Request("http://localhost/secured/me", { headers }))
        ).text(),
      ).toBe("me");

      const revocation = application.get(RevocationService);
      await revocation.revoke("access-1", Date.now() + 60_000);

      const response = await application.handle(
        new Request("http://localhost/secured/me", { headers }),
      );
      expect(response.status).toBe(401);
      const body: unknown = await response.json();
      expect(body).toMatchObject({ detail: "Authentication token has been revoked." });
    } finally {
      await application.close();
      application = undefined;
    }
  });

  test("mints a jti for a framework-signed token so revocation reaches it", async () => {
    @Controller("secured-auto")
    @UseGuards(AuthGuard)
    class SecuredAutoController {
      @Get("me")
      me(): string {
        return "me";
      }
    }

    @Module({
      imports: [AuthModule.register({ jwt: { secret: "x".repeat(32) } })],
      controllers: [SecuredAutoController],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const jwt = application.get(JwtService);
      const token = await jwt.sign({ sub: "ada" });
      const payload = decodeJwt(token);
      expect(typeof payload.jti).toBe("string");

      const headers = { authorization: `Bearer ${token}` };
      expect(
        await (
          await application.handle(new Request("http://localhost/secured-auto/me", { headers }))
        ).text(),
      ).toBe("me");

      await application.get(RevocationService).revoke(payload.jti as string, Date.now() + 60_000);
      const response = await application.handle(
        new Request("http://localhost/secured-auto/me", { headers }),
      );
      expect(response.status).toBe(401);
    } finally {
      await application.close();
      application = undefined;
    }
  });
});

function capture(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}

async function reject(promise: Promise<unknown>): Promise<AponiaError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the promise to reject with an AponiaError.");
}
