import { afterAll, describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  AuthGuard,
  AuthModule,
  AuthService,
  JwtService,
  RefreshTokenService,
  RevocationService,
  type RefreshTokenRecord,
  type RefreshTokenStore,
  type RevocationStore,
} from "../src/index.ts";

const secret = "x".repeat(32);

class SharedRefreshStore implements RefreshTokenStore {
  readonly records = new Map<string, RefreshTokenRecord>();
  creates = 0;
  deletes = 0;

  async create(record: RefreshTokenRecord): Promise<void> {
    this.creates += 1;
    this.records.set(record.idHash, record);
  }

  async find(idHash: string): Promise<RefreshTokenRecord | undefined> {
    return this.records.get(idHash);
  }

  async delete(idHash: string): Promise<boolean> {
    this.deletes += 1;
    return this.records.delete(idHash);
  }

  async deleteFamily(familyId: string): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.records) {
      if (record.familyId === familyId) {
        this.records.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async clear(): Promise<void> {
    this.records.clear();
  }
}

class SharedRevocationStore implements RevocationStore {
  readonly entries = new Map<string, number>();

  async revoke(jti: string, expiresAt: number): Promise<void> {
    this.entries.set(jti, expiresAt);
  }

  async isRevoked(jti: string): Promise<boolean> {
    return this.entries.has(jti);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

@Controller("shared")
@UseGuards(AuthGuard)
class SharedController {
  constructor(private readonly auth: AuthService) {}

  @Get("me")
  me(): string {
    return String(this.auth.current()?.id ?? "none");
  }
}

const applications: AponiaApplication[] = [];

afterAll(async () => {
  for (const application of applications) {
    await application.close();
  }
});

describe("shared auth stores", () => {
  test("two applications share refresh rotation and revocation", async () => {
    const refresh = new SharedRefreshStore();
    const revocation = new SharedRevocationStore();
    const firstAuth = AuthModule.register({
      jwt: { secret },
      refresh: { store: refresh },
      revocation: { store: revocation },
    });
    const secondAuth = AuthModule.register({
      jwt: { secret },
      refresh: { store: refresh },
      revocation: { store: revocation },
    });

    @Module({ imports: [firstAuth], controllers: [SharedController] })
    class FirstModule {}

    @Module({ imports: [secondAuth], controllers: [SharedController] })
    class SecondModule {}

    const first = await AponiaFactory.create(FirstModule, { logger: false });
    const second = await AponiaFactory.create(SecondModule, { logger: false });
    applications.push(first, second);

    const issued = await first.get(RefreshTokenService).issue("ada");
    const rotated = await second.get(RefreshTokenService).rotate(issued.token);

    expect(rotated.userId).toBe("ada");
    expect(rotated.familyId).toBe(issued.familyId);
    expect(refresh.creates).toBe(2);
    expect(refresh.deletes).toBe(1);

    const token = await first.get(JwtService).sign({ sub: "ada", jti: "shared-jti" });
    const headers = { authorization: `Bearer ${token}` };
    expect(
      await (await first.handle(new Request("http://localhost/shared/me", { headers }))).text(),
    ).toBe("ada");

    await second.get(RevocationService).revoke("shared-jti", Date.now() + 60_000);

    expect(
      (await first.handle(new Request("http://localhost/shared/me", { headers }))).status,
    ).toBe(401);
    expect(revocation.entries.has("shared-jti")).toBe(true);
  });

  test("refuses a supplied store that does not implement its contract", () => {
    const refresh = capture(() =>
      AuthModule.register({
        jwt: { secret },
        refresh: { store: {} as unknown as RefreshTokenStore },
      }),
    );
    const revocation = capture(() =>
      AuthModule.register({
        jwt: { secret },
        revocation: { store: {} as unknown as RevocationStore },
      }),
    );
    const noRefresh = capture(() =>
      AuthModule.register({
        jwt: { secret },
        refresh: { store: null as unknown as RefreshTokenStore },
      }),
    );
    const noRevocation = capture(() =>
      AuthModule.register({
        jwt: { secret },
        revocation: { store: null as unknown as RevocationStore },
      }),
    );

    expect(refresh.code).toBe("INVALID_AUTH_OPTIONS");
    expect(refresh.message).toContain(
      "refresh.store is missing create, find, delete, deleteFamily, clear",
    );
    expect(revocation.code).toBe("INVALID_AUTH_OPTIONS");
    expect(revocation.message).toContain("revocation.store is missing revoke, isRevoked, clear");
    expect(noRefresh.message).toContain("must implement RefreshTokenStore");
    expect(noRevocation.message).toContain("must implement RevocationStore");
  });

  test("keeps the built-in stores isolated per registration", async () => {
    const first = await AponiaFactory.create(
      defineModuleFor(AuthModule.register({ jwt: { secret } })),
      { logger: false },
    );
    const second = await AponiaFactory.create(
      defineModuleFor(AuthModule.register({ jwt: { secret } })),
      { logger: false },
    );
    applications.push(first, second);

    const issued = await first.get(RefreshTokenService).issue("ada");

    expect(second.get(RefreshTokenService).rotate(issued.token)).rejects.toThrow(
      "invalid, expired, or already used",
    );
  });
});

function defineModuleFor(imports: ReturnType<typeof AuthModule.register>) {
  @Module({ imports: [imports], controllers: [SharedController] })
  class IsolatedModule {}
  return IsolatedModule;
}

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
