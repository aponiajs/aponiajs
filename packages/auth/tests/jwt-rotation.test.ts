import { describe, expect, test } from "bun:test";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { SignJWT, decodeProtectedHeader } from "jose";
import { AuthModule, JwtService, type JwtOptions } from "../src/index.ts";

const oldSecret = "o".repeat(32);
const newSecret = "n".repeat(32);
const issuer = "https://issuer.example";
const audience = "aponia-api";

async function serviceFor(options: JwtOptions): Promise<JwtService> {
  @Module({ imports: [AuthModule.register({ jwt: options })] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    return application.get(JwtService);
  } finally {
    await application.close();
  }
}

describe("JWT signing-key rotation", () => {
  test("signs with the active key and names its kid", async () => {
    const jwt = await serviceFor({
      secret: oldSecret,
      issuer,
      audience,
      keys: [
        { kid: "old", secret: oldSecret },
        { kid: "new", secret: newSecret },
      ],
      activeKid: "new",
    });

    const token = await jwt.sign({ sub: "ada" });

    expect(decodeProtectedHeader(token).kid).toBe("new");
    expect((await jwt.verify(token)).id).toBe("ada");
  });

  test("defaults the active key to the first entry of the list", async () => {
    const jwt = await serviceFor({
      secret: oldSecret,
      keys: [{ kid: "first", secret: oldSecret }],
    });

    expect(decodeProtectedHeader(await jwt.sign({ sub: "ada" })).kid).toBe("first");
  });

  test("accepts a token an older key signed and a legacy token without a kid", async () => {
    const jwt = await serviceFor({
      secret: oldSecret,
      issuer,
      audience,
      keys: [
        { kid: "old", secret: oldSecret },
        { kid: "new", secret: newSecret },
      ],
      activeKid: "new",
    });
    const oldToken = await new SignJWT({ sub: "old-user" })
      .setProtectedHeader({ alg: "HS256", kid: "old" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(oldSecret));
    const legacyToken = await new SignJWT({ sub: "legacy" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(oldSecret));

    expect((await jwt.verify(oldToken)).id).toBe("old-user");
    expect((await jwt.verify(legacyToken)).id).toBe("legacy");
  });

  test("refuses a token that names a kid the rotation list does not hold", async () => {
    const jwt = await serviceFor({
      secret: oldSecret,
      keys: [{ kid: "old", secret: oldSecret }],
    });
    const unknown = await new SignJWT({ sub: "intruder" })
      .setProtectedHeader({ alg: "HS256", kid: "retired" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(oldSecret));

    expect(await rejection(jwt.verify(unknown))).toMatchObject({ code: "INVALID_AUTH_TOKEN" });
  });

  test("refuses a token that no configured key signed", async () => {
    const jwt = await serviceFor({
      secret: oldSecret,
      keys: [{ kid: "old", secret: oldSecret }],
    });
    const forged = await new SignJWT({ sub: "intruder" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("f".repeat(32)));

    expect(await rejection(jwt.verify(forged))).toMatchObject({ code: "INVALID_AUTH_TOKEN" });
  });

  test("refuses a rotation list it cannot use", () => {
    const duplicate = capture(() =>
      AuthModule.register({
        jwt: {
          secret: oldSecret,
          keys: [
            { kid: "same", secret: oldSecret },
            { kid: "same", secret: newSecret },
          ],
        },
      }),
    );
    const short = capture(() =>
      AuthModule.register({ jwt: { secret: oldSecret, keys: [{ kid: "x", secret: "short" }] } }),
    );
    const missingActive = capture(() =>
      AuthModule.register({ jwt: { secret: oldSecret, activeKid: "absent" } }),
    );
    const blankKid = capture(() =>
      AuthModule.register({ jwt: { secret: oldSecret, keys: [{ kid: " ", secret: oldSecret }] } }),
    );
    const notAList = capture(() =>
      AuthModule.register({
        jwt: {
          secret: oldSecret,
          keys: "no" as unknown as readonly { kid: string; secret: string }[],
        },
      }),
    );

    expect(duplicate.message).toContain('declares the kid "same" twice');
    expect(short.message).toContain("needs a secret of at least 32 characters");
    expect(missingActive.message).toContain("activeKid must name one of jwt.keys");
    expect(blankKid.message).toContain("need a non-empty kid");
    expect(notAList.message).toContain("jwt.keys must be an array");
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

async function rejection(promise: Promise<unknown>): Promise<AponiaError> {
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
