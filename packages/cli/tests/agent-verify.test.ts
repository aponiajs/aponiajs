import { expect, test } from "bun:test";
import { runVerification } from "../src/agent/verify.ts";

test("runs the allowlisted contract scope and reports its command", async () => {
  const result = await runVerification("contract", process.cwd());

  expect(result.scope).toBe("contract");
  expect(result.ok).toBe(true);
  expect(result.checks).toHaveLength(1);
  expect(result.checks[0]?.command).toEqual(["bun", "run", "release:verify"]);
  expect(result.checks[0]?.timedOut).toBe(false);
  expect(result.checks[0]?.stdout.length).toBeGreaterThan(0);
});
