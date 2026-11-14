import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { parseArguments } from "../src/index.ts";
import { initAgent } from "../src/agent/init-agent.ts";

test("parses the agent init command and its client list", () => {
  expect(
    parseArguments([
      "agent",
      "init",
      "--clients",
      "codex,cursor",
      "--dry-run",
      "--cwd",
      "/tmp/app",
    ]),
  ).toEqual({
    command: "agent",
    action: "init",
    clients: ["codex", "cursor"],
    dryRun: true,
    cwd: "/tmp/app",
  });
  expect(() => parseArguments(["agent", "init", "--clients", "other"])).toThrow(
    'Unknown agent client "other".',
  );
});

test("plans and installs client guidance idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "aponia-agent-init-"));
  await Bun.write(join(root, "AGENTS.md"), "# Existing project guidance\n");

  const planned = await initAgent({ cwd: root, clients: ["codex", "cursor"], dryRun: true });
  expect(planned.dryRun).toBe(true);
  expect(planned.changes.map((change) => change.path)).toEqual([
    "AGENTS.md",
    ".agents/skills/aponia/SKILL.md",
    ".cursor/rules/aponia.mdc",
  ]);
  expect((await Bun.file(join(root, "AGENTS.md")).text()).includes("aponia:begin")).toBe(false);

  const written = await initAgent({ cwd: root, clients: ["codex", "cursor"] });
  expect(written.changes.map((change) => change.kind)).toEqual(["UPDATE", "CREATE", "CREATE"]);
  const agents = await Bun.file(join(root, "AGENTS.md")).text();
  expect(agents).toContain("# Existing project guidance");
  expect(agents.match(/aponia:begin/g)).toHaveLength(1);

  const repeated = await initAgent({ cwd: root, clients: ["codex", "cursor"] });
  expect(repeated.changes).toEqual([]);
});
