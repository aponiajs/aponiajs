import { describe, expect, test } from "bun:test";
import { AponiaError, Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import {
  AuthGuard,
  AuthModule,
  JwtService,
  OidcService,
  Public,
  type OidcOptions,
} from "../src/index.ts";

const issuer = "https://issuer.example";
const audience = "aponia-api";

describe("OidcService", () => {
  test("discovers the provider and verifies a signed token", async () => {
    const provider = await keyProvider();
    const oidc = new OidcService({ ...oidcOptions(provider), audience });

    const token = await provider.sign({ sub: "ada", roles: ["admin"] });
    const user = await oidc.verify(token);

    expect(user.id).toBe("ada");
    expect(user.roles).toEqual(["admin"]);
    expect(Object.isFrozen(user)).toBe(true);
  });

  test("reads the discovery document once and re-reads it after clear", async () => {
    const provider = await keyProvider();
    const oidc = new OidcService(oidcOptions(provider));

    await oidc.discover();
    await oidc.discover();
    expect(provider.discoveryCalls).toBe(1);

    oidc.clear();
    await oidc.discover();
    expect(provider.discoveryCalls).toBe(2);
  });

  test("refuses a token for another audience, issuer, or signature", async () => {
    const provider = await keyProvider();
    const oidc = new OidcService({ ...oidcOptions(provider), audience });
    const impostor = await keyProvider();

    for (const token of [
      await provider.sign({ sub: "ada" }, { audience: "other" }),
      await provider.sign({ sub: "ada" }, { issuer: "https://other.example" }),
      await impostor.sign({ sub: "ada" }),
      "not-a-token",
    ]) {
      const error = await reject(oidc.verify(token));
      expect(error.code).toBe("INVALID_AUTH_TOKEN");
    }
  });

  test("reports every reason the discovery document is unusable", async () => {
    const cases: readonly [typeof fetch, string][] = [
      [failingFetch(), "the request failed"],
      [jsonFetch({}, 500), "it answered 500"],
      [textFetch("not json"), "the body is not JSON"],
      [jsonFetch([1, 2, 3]), "the body is not an object"],
      [jsonFetch({ issuer: "https://other.example", jwks_uri: jwksUrl }), "a different issuer"],
      [jsonFetch({ issuer }), "no usable jwks_uri"],
      [jsonFetch({ issuer, jwks_uri: "relative/path" }), "no usable jwks_uri"],
    ];

    for (const [fetch, reason] of cases) {
      const oidc = new OidcService({ issuer, fetch });
      const error = await reject(oidc.discover());

      expect(error.code).toBe("OIDC_DISCOVERY_FAILED");
      expect(error.message).toContain(reason);
      expect(error.details).toEqual({ url: `${issuer}/.well-known/openid-configuration` });
    }
  });

  test("validates its options", () => {
    expect(capture(() => new OidcService({ issuer: " " })).code).toBe("INVALID_AUTH_OPTIONS");
    expect(capture(() => new OidcService({ issuer, audience: "" })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
    expect(capture(() => new OidcService({ issuer, algorithms: [] })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
    expect(capture(() => new OidcService({ issuer, timeoutMs: 0 })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
    expect(capture(() => new OidcService({ issuer, clockTolerance: -1 })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
    expect(capture(() => new OidcService({ issuer, discoveryUrl: "ftp://x" })).code).toBe(
      "INVALID_AUTH_OPTIONS",
    );
  });
});

describe("OIDC through AuthModule", () => {
  test("protects a route with a provider-issued token", async () => {
    const provider = await keyProvider();

    @Controller("oidc")
    @UseGuards(AuthGuard)
    class OidcController {
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
      imports: [AuthModule.register({ oidc: { ...oidcOptions(provider), audience } })],
      controllers: [OidcController],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    try {
      expect(application.get(OidcService)).toBeInstanceOf(OidcService);
      const token = await provider.sign({ sub: "ada" });
      const headers = { authorization: `Bearer ${token}` };

      expect(
        await (
          await application.handle(new Request("http://localhost/oidc/me", { headers }))
        ).text(),
      ).toBe("me");
      expect((await application.handle(new Request("http://localhost/oidc/me"))).status).toBe(401);
    } finally {
      await application.close();
    }
  });

  test("refuses a registration that states both verifiers or neither", () => {
    const both = capture(() =>
      AuthModule.register({
        jwt: { secret: "x".repeat(32) },
        oidc: { issuer },
      } as unknown as Parameters<typeof AuthModule.register>[0]),
    );
    const neither = capture(() =>
      AuthModule.register({} as unknown as Parameters<typeof AuthModule.register>[0]),
    );

    expect(both.code).toBe("INVALID_AUTH_OPTIONS");
    expect(neither.code).toBe("INVALID_AUTH_OPTIONS");
    expect(neither.details).toEqual({ issues: ["exactly one of jwt or oidc must be present"] });
  });
});

describe("JwtService claims", () => {
  test("signs the configured issuer and audience so verification accepts the token", async () => {
    const jwt = new JwtService({
      secret: "x".repeat(32),
      issuer,
      audience,
      algorithms: ["HS256"],
      expiresIn: "1h",
    });
    const token = await jwt.sign({ sub: "ada" });

    expect((await jwt.verify(token)).id).toBe("ada");
  });
});

const jwksUrl = `${issuer}/jwks`;

interface KeyProvider {
  readonly discoveryCalls: number;
  sign(
    claims: Record<string, unknown>,
    overrides?: { readonly audience?: string; readonly issuer?: string },
  ): Promise<string>;
}

async function keyProvider(): Promise<KeyProvider & OidcOptions> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
  let discoveryCalls = 0;
  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `${issuer}/.well-known/openid-configuration`) {
      discoveryCalls += 1;
      return jsonFetch({ issuer, jwks_uri: jwksUrl })(input);
    }
    if (url === jwksUrl) {
      return jsonFetch({ keys: [jwk] })(input);
    }
    return new Response("missing", { status: 404 });
  }) as typeof globalThis.fetch;

  const provider = {
    get discoveryCalls(): number {
      return discoveryCalls;
    },
    issuer,
    fetch,
    sign: async (
      claims: Record<string, unknown>,
      overrides: { readonly audience?: string; readonly issuer?: string } = {},
    ): Promise<string> =>
      await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "key-1" })
        .setIssuer(overrides.issuer ?? issuer)
        .setAudience(overrides.audience ?? audience)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey),
  };
  return provider;
}

function oidcOptions(provider: OidcOptions): OidcOptions {
  return { issuer: provider.issuer, fetch: provider.fetch };
}

function jsonFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

function textFetch(body: string): typeof globalThis.fetch {
  return (async () =>
    new Response(body, {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof globalThis.fetch;
}

function failingFetch(): typeof globalThis.fetch {
  return (async () => {
    throw new Error("offline");
  }) as unknown as typeof globalThis.fetch;
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
