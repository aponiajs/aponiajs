import { expect, test } from "bun:test";
import { Controller, Get, Module, UseGuards } from "@aponiajs/common";
import { createPlatformFactory, type AponiaApplicationContract } from "@aponiajs/platform-core";
import { h3Adapter } from "@aponiajs/platform-h3";
import { honoAdapter } from "@aponiajs/platform-hono";
import { AuthGuard, AuthModule, JwtService } from "./index.ts";

const secret = "a-secret-that-is-at-least-32-characters-long";

@Controller("secure")
class SecureController {
  @Get("/")
  @UseGuards(AuthGuard)
  read(): string {
    return "read";
  }
}

@Module({
  imports: [AuthModule.register({ jwt: { secret } })],
  controllers: [SecureController],
})
class AppModule {}

// The package is runtime-neutral: it reaches the request through
// `RequestContextService` and the failures through `httpErrors`, so the same
// module and the same guard answer on every platform.
async function assertAuthenticated(application: AponiaApplicationContract): Promise<void> {
  const anonymous = await application.handle(new Request("http://localhost/secure"));
  expect(anonymous.status).toBe(401);

  const token = await application.get(JwtService).sign({ sub: "ada" });
  const authorized = await application.handle(
    new Request("http://localhost/secure", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );

  expect(authorized.status).toBe(200);
  expect(await authorized.text()).toBe("read");
}

test("answers an authenticated request on hono", async () => {
  const application = await createPlatformFactory(honoAdapter()).create(AppModule, {
    logger: false,
  });

  try {
    await assertAuthenticated(application);
  } finally {
    await application.close();
  }
});

test("answers an authenticated request on h3", async () => {
  const application = await createPlatformFactory(h3Adapter()).create(AppModule, { logger: false });

  try {
    await assertAuthenticated(application);
  } finally {
    await application.close();
  }
});
