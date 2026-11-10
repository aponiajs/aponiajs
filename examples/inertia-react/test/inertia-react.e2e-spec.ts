import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

const application = await AponiaFactory.create(AppModule, { logger: false });

afterAll(async () => {
  await application.close();
});

test("answers a React Inertia page on first load and SPA navigation", async () => {
  const full = await application.handle(new Request("http://localhost/users"));
  const html = await full.text();
  expect(html).toContain('id="app"');
  expect(html).toContain("Users/Index");

  const spa = await application.handle(
    new Request("http://localhost/users", { headers: { "x-inertia": "true" } }),
  );
  expect(spa.headers.get("x-inertia")).toBe("true");
  const page = (await spa.json()) as {
    component: string;
    props: { users: { name: string }[] };
  };
  expect(page.component).toBe("Users/Index");
  expect(page.props.users.map((user) => user.name)).toEqual(["Ada", "Linus"]);
});

test("bundles the React client entry", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "aponia-inertia-react-"));
  try {
    const result = await Bun.build({
      entrypoints: [new URL("../src/client.tsx", import.meta.url).pathname],
      outdir,
      target: "browser",
    });
    expect(result.success).toBe(true);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
