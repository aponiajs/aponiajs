import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AuthGuard,
  AuthService,
  JwtService,
  PermissionsGuard,
  RolesGuard,
  type AuthUser,
} from "@aponiajs/auth";
import type { AponiaApplication } from "@aponiajs/platform-elysia";
import { QueueService } from "@aponiajs/queue";
import { createApplication, get, send } from "./application.ts";

let application: AponiaApplication;
let token: string;

beforeAll(async () => {
  application = await createApplication();
  const response = await send(application, "/auth/login", "POST", {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });
  token = ((await response.json()) as { token: string }).token;
});

function authorized(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("reference application", () => {
  test("answers the public ping and the health probes", async () => {
    expect(await (await get(application, "/public/ping")).json()).toEqual({
      service: "aponia-reference",
    });
    expect((await get(application, "/health/live")).status).toBe(200);
    expect((await get(application, "/health/ready")).status).toBe(200);
  });

  test("logs in the seeded administrator and refuses a wrong password", async () => {
    const success = await send(application, "/auth/login", "POST", {
      email: "ada@example.com",
      password: "correct horse battery staple",
    });
    const body = (await success.json()) as { token: string; user: { roles: string[] } };

    expect(success.status).toBe(200);
    expect(body.user.roles).toEqual(["admin"]);
    expect(body.token.split(".")).toHaveLength(3);

    const failure = await send(application, "/auth/login", "POST", {
      email: "ada@example.com",
      password: "wrong password",
    });
    expect(failure.status).toBe(401);
  });

  test("protects the user list and answers the administrator", async () => {
    expect((await get(application, "/users")).status).toBe(401);

    const response = await get(application, "/users", { headers: authorized() });
    const users = (await response.json()) as readonly { email: string; roles: string[] }[];

    expect(response.status).toBe(200);
    expect(users.some((user) => user.email === "ada@example.com")).toBe(true);
    expect(JSON.stringify(users)).not.toContain("passwordHash");
  });

  test("creates a user, runs the queued audit, and reports the metric", async () => {
    const created = await send(
      application,
      "/users",
      "POST",
      { email: "grace@example.com", name: "Grace Hopper", password: "compiler-1952" },
      authorized(),
    );

    expect(created.status).toBeLessThan(300);
    expect(((await created.json()) as { roles: string[] }).roles).toEqual(["member"]);

    await application.get(QueueService).waitForIdle();
    const audit = (await (
      await get(application, "/users/audit", { headers: authorized() })
    ).json()) as readonly { type: string; userId: string }[];
    expect(audit.some((record) => record.type === "user.created")).toBe(true);
    expect(audit).toHaveLength(1);

    const scrape = await (await get(application, "/metrics")).text();
    expect(scrape).toContain("reference_users_created_total 1");
    expect(scrape).toContain("reference_http_requests_total");
  });

  test("refuses a user without the administrator role", async () => {
    const token = await application.get(JwtService).sign({ sub: "viewer", roles: ["viewer"] });

    const response = await get(application, "/users", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
  });

  test("exposes the guards and services the application exports", () => {
    expect(application.get(AuthGuard)).toBeDefined();
    expect(application.get(RolesGuard)).toBeDefined();
    expect(application.get(PermissionsGuard)).toBeDefined();
    const auth = application.get(AuthService);
    expect(auth.current()).toBeUndefined();
    const user: AuthUser = { id: "ada" };
    expect(user.id).toBe("ada");
  });
});

afterAll(async () => {
  await application.close();
});
