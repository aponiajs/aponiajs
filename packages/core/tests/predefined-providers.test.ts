import { describe, expect, test } from "bun:test";
import { createToken, defineModule, provideValue } from "@aponiajs/common";
import { createContainer } from "../src/index.ts";

const PREDEFINED_TOKEN = createToken<string>("predefined.token");
const OTHER_TOKEN = createToken<string>("other.token");

describe("predefined provider resolution tier in @aponiajs/core", () => {
  test("resolves a predefined provider when neither the module nor its imports declare it", () => {
    const root = defineModule({
      id: "RootModule",
    });

    const container = createContainer(root, [
      provideValue(PREDEFINED_TOKEN, "fallback-predefined-value"),
    ]);

    expect(container.get(PREDEFINED_TOKEN)).toBe("fallback-predefined-value");
  });

  test("a module's own provider takes precedence over the predefined provider", () => {
    const root = defineModule({
      id: "RootModule",
      providers: [provideValue(PREDEFINED_TOKEN, "own-module-value")],
    });

    const container = createContainer(root, [
      provideValue(PREDEFINED_TOKEN, "fallback-predefined-value"),
    ]);

    expect(container.get(PREDEFINED_TOKEN)).toBe("own-module-value");
  });

  test("an imported module's exported provider takes precedence over the predefined provider", () => {
    const imported = defineModule({
      id: "ImportedModule",
      providers: [provideValue(PREDEFINED_TOKEN, "imported-value")],
      exports: [PREDEFINED_TOKEN],
    });

    const root = defineModule({
      id: "RootModule",
      imports: [imported],
    });

    const container = createContainer(root, [
      provideValue(PREDEFINED_TOKEN, "fallback-predefined-value"),
    ]);

    expect(container.get(PREDEFINED_TOKEN)).toBe("imported-value");
  });

  test("ambiguous exported providers still throw AMBIGUOUS_PROVIDER rather than falling back", () => {
    const left = defineModule({
      id: "LeftModule",
      providers: [provideValue(PREDEFINED_TOKEN, "left-value")],
      exports: [PREDEFINED_TOKEN],
    });

    const right = defineModule({
      id: "RightModule",
      providers: [provideValue(PREDEFINED_TOKEN, "right-value")],
      exports: [PREDEFINED_TOKEN],
    });

    const root = defineModule({
      id: "RootModule",
      imports: [left, right],
    });

    const container = createContainer(root, [
      provideValue(PREDEFINED_TOKEN, "fallback-predefined-value"),
    ]);

    expect(() => container.get(PREDEFINED_TOKEN)).toThrow(
      expect.objectContaining({
        code: "AMBIGUOUS_PROVIDER",
      }),
    );
  });

  test("throws MISSING_PROVIDER for tokens not in the module and not predefined", () => {
    const root = defineModule({
      id: "RootModule",
    });

    const container = createContainer(root, [
      provideValue(PREDEFINED_TOKEN, "fallback-predefined-value"),
    ]);

    expect(() => container.get(OTHER_TOKEN)).toThrow(
      expect.objectContaining({
        code: "MISSING_PROVIDER",
      }),
    );
  });
});
