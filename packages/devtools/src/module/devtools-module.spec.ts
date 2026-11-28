import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { DevtoolsModule, devtoolsPathPrefix } from "../index.ts";

@Controller("greet")
class GreetController {
  @Get()
  read(): string {
    return "hello";
  }
}

let application: AponiaApplication | undefined;

async function boot(
  options: Parameters<typeof DevtoolsModule.forRoot>[0],
): Promise<AponiaApplication> {
  @Module({
    imports: [DevtoolsModule.forRoot(options)],
    controllers: [GreetController],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });
  return application;
}

test("a disabled registration is inert", () => {
  const disabled = DevtoolsModule.forRoot({ enabled: false });
  expect(disabled.providers).toEqual([]);
  expect(disabled.controllers).toBeUndefined();
});

test("an enabled registration mounts the surface on the application's own address", async () => {
  const app = await boot({ enabled: true });
  try {
    const meta = await app.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`));
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ contract: 4 });

    const page = await app.handle(new Request(`http://localhost${devtoolsPathPrefix}`));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    expect(
      (await app.handle(new Request(`http://localhost${devtoolsPathPrefix}/missing`))).status,
    ).toBe(404);
    // Mounting explicit routes makes a non-GET request a routing `404` rather
    // than the dispatcher's `405`; the dispatcher still answers 405 directly.
    expect(
      (
        await app.handle(
          new Request(`http://localhost${devtoolsPathPrefix}/meta`, { method: "POST" }),
        )
      ).status,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test.serial("an enabled registration reports its mount once at bootstrap", async () => {
  const stdout: string[] = [];
  const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });

  try {
    const app = await boot({ enabled: true });
    await app.close();
  } finally {
    stdoutWrite.mockRestore();
  }

  const output = stdout.join("");
  const mountLine = `Aponia devtools is mounted at ${devtoolsPathPrefix} on the application's own address.`;
  expect(output).toContain(mountLine);
  expect(output.split(mountLine)).toHaveLength(2);
});

test("an authorize hook protects every endpoint", async () => {
  const app = await boot({
    enabled: true,
    authorize: (request) => request.headers.get("x-devtools") === "yes",
  });
  try {
    const denied = await app.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`));
    expect(denied.status).toBe(401);

    const allowed = await app.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/meta`, {
        headers: { "x-devtools": "yes" },
      }),
    );
    expect(allowed.status).toBe(200);
  } finally {
    await app.close();
  }
});

test("the surface's own traffic is left out of the request record", async () => {
  const app = await boot({ enabled: true });
  try {
    await app.handle(new Request("http://localhost/greet"));
    await app.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`));

    const response = await app.handle(
      new Request(`http://localhost${devtoolsPathPrefix}/requests`),
    );
    const payload = (await response.json()) as { entries: { url: string }[] };

    expect(payload.entries.map((entry) => entry.url)).toContain("/greet");
    expect(payload.entries.map((entry) => entry.url)).not.toContain(`${devtoolsPathPrefix}/meta`);
  } finally {
    await app.close();
  }
});
