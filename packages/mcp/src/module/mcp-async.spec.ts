import { expect, test } from "bun:test";
import { createToken, provideValue, type Provider } from "@aponiajs/common";
import { McpModule } from "../index.ts";
import { MCP_OPTIONS } from "./mcp.module.ts";
import type { ResolvedMcpOptions } from "../interfaces/mcp-module.interface.ts";

function optionsProvider(providers: readonly unknown[] | undefined): Provider {
  const provider = (providers ?? []).find(
    (entry): entry is Provider =>
      typeof entry === "object" &&
      entry !== null &&
      "kind" in entry &&
      "provide" in entry &&
      entry.provide === MCP_OPTIONS,
  );
  if (provider === undefined) {
    throw new Error("expected an MCP options provider");
  }
  return provider;
}

test("awaits an asynchronous factory and resolves its metadata", async () => {
  const registration = McpModule.forRootAsync({
    useFactory: async () => ({ name: "async-server", version: "2.0.0" }),
  });
  const provider = optionsProvider(registration.providers);

  if (provider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  const options = (await provider.useFactory()) as ResolvedMcpOptions;
  expect(options.name).toBe("async-server");
  expect(options.version).toBe("2.0.0");
  expect(options.path).toBe("/mcp");
});

test("reads metadata from a factory class and from an existing factory", async () => {
  class OptionsFactory {
    async create(): Promise<{ readonly name: string; readonly version: string }> {
      return { name: "class-server", version: "3.0.0" };
    }
  }

  const byClass = McpModule.forRootAsync({ useClass: OptionsFactory });
  const classProvider = optionsProvider(byClass.providers);
  if (classProvider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  const readClass = classProvider.useFactory as unknown as (
    factory: OptionsFactory,
  ) => Promise<unknown>;
  expect(await readClass(new OptionsFactory())).toEqual(
    expect.objectContaining({ name: "class-server", version: "3.0.0" }),
  );
  expect(byClass.providers).toContainEqual(
    expect.objectContaining({ kind: "class", provide: OptionsFactory }),
  );

  const existing = McpModule.forRootAsync({ useExisting: OptionsFactory });
  const existingProvider = optionsProvider(existing.providers);
  if (existingProvider.kind !== "factory") {
    throw new Error("expected a factory provider");
  }
  const readExisting = existingProvider.useFactory as unknown as (
    factory: OptionsFactory,
  ) => Promise<unknown>;
  expect(await readExisting(new OptionsFactory())).toEqual(
    expect.objectContaining({ name: "class-server", version: "3.0.0" }),
  );
});

test("appends extraProviders beside the generated options provider", () => {
  const EXTRA = createToken<number>("mcp.extra");
  const extra = provideValue(EXTRA, 1);
  const registration = McpModule.forRootAsync({
    useFactory: () => ({ name: "extra-server", version: "1.0.0" }),
    extraProviders: [extra],
  });

  expect(registration.providers).toContain(extra);
});
