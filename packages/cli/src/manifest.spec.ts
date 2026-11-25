import { expect, spyOn, test } from "bun:test";
import { parseArguments, runCli } from "./index.ts";

test("parses the manifest command", () => {
  expect(parseArguments(["manifest"])).toEqual({ command: "manifest" });
  expect(() => parseArguments(["manifest", "extra"])).toThrow('Unexpected argument "extra".');
});

test("prints the framework contract", async () => {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    lines.push(String(message));
  });

  try {
    expect(await runCli(["manifest"])).toBe(0);
  } finally {
    log.mockRestore();
  }

  const contract = JSON.parse(lines.join("\n")) as {
    readonly contractVersion: number;
    readonly errorCodes: readonly string[];
    readonly platformCapabilities: { readonly capabilities: readonly string[] };
  };
  expect(contract.contractVersion).toBe(2);
  expect(contract.errorCodes).toContain("MISSING_PROVIDER");
  expect(contract.platformCapabilities.capabilities).toContain("http");
});
