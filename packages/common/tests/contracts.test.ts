import { describe, expect, test } from "bun:test";
import {
  ConsoleLogger,
  createToken,
  defineModule,
  provideFactory,
  provideValue,
  tokenName,
} from "../src/index.ts";

describe("@aponiajs/common", () => {
  test("creates typed identity tokens", () => {
    const first = createToken<number>("count");
    const second = createToken<number>("count");

    expect(first).not.toBe(second);
    expect(tokenName(first)).toBe("count");
  });

  test("creates immutable module and provider descriptors", () => {
    const count = createToken<number>("count");
    const doubled = createToken<number>("doubled");
    const module = defineModule({
      id: "values",
      providers: [
        provideValue(count, 2),
        provideFactory(doubled, [count] as const, (value) => value * 2),
      ],
      exports: [doubled],
    });

    expect(Object.isFrozen(module)).toBe(true);
    expect(Object.isFrozen(module.providers)).toBe(true);
    expect(module.providers).toHaveLength(2);
  });

  test("uses cascading Nest-style log levels", () => {
    const logger = new ConsoleLogger({
      colors: false,
      logLevels: ["warn"],
    });

    expect(logger.isLevelEnabled("fatal")).toBe(true);
    expect(logger.isLevelEnabled("error")).toBe(true);
    expect(logger.isLevelEnabled("warn")).toBe(true);
    expect(logger.isLevelEnabled("log")).toBe(false);
  });
});
