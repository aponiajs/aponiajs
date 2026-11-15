import { describe, expect, test } from "bun:test";
import { AponiaError, type ArgumentMetadata, type PipeTransform } from "@aponiajs/common";
import { type AponiaContainer } from "@aponiajs/core";
import {
  executePipes,
  resolveApplicationPipe,
  resolveApplicationPipes,
  resolvePipe,
} from "../src/index.ts";

class ValidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    return value.toUpperCase();
  }
}

class PipeWithThrowingConstructor implements PipeTransform {
  constructor() {
    throw new Error("fail on construct");
  }

  transform(val: unknown) {
    return val;
  }
}

describe("pipe-resolver", () => {
  test("resolves from container when available", () => {
    const pipeInstance = new ValidPipe();
    const mockContainer = {
      get: (token: unknown) => (token === ValidPipe ? pipeInstance : undefined),
    } as unknown as AponiaContainer;

    const resolved = resolvePipe(ValidPipe, mockContainer);
    expect(resolved.instance).toBe(pipeInstance);
  });

  test("falls back to instantiation when container throws", () => {
    const mockContainer = {
      get: () => {
        throw new Error("missing");
      },
    } as unknown as AponiaContainer;

    const resolved = resolvePipe(ValidPipe, mockContainer);
    expect(resolved.instance).toBeInstanceOf(ValidPipe);
  });

  test("throws INVALID_PIPE when constructor throws", () => {
    expect(() => resolvePipe(PipeWithThrowingConstructor)).toThrow(AponiaError);
    try {
      resolvePipe(PipeWithThrowingConstructor);
    } catch (error) {
      expect((error as AponiaError).code).toBe("INVALID_PIPE");
    }
  });

  test("throws INVALID_PIPE when non-pipe object is passed", () => {
    expect(() => resolvePipe({} as never)).toThrow(AponiaError);
    expect(() => resolvePipe(null as never)).toThrow(AponiaError);
  });

  test("an application-level pipe given as an instance is used as given", () => {
    const pipeInstance = new ValidPipe();
    const resolved = resolveApplicationPipe(pipeInstance, {} as AponiaContainer);

    expect(resolved.instance).toBe(pipeInstance);
  });

  test("an application-level pipe the root cannot reach fails instead of resolving empty", () => {
    class UnreachablePipe implements PipeTransform {
      transform(value: unknown): unknown {
        return value;
      }
    }
    const container = {
      get: () => {
        throw new Error("not provided");
      },
    } as unknown as AponiaContainer;

    expect(() => resolveApplicationPipe(UnreachablePipe, container)).toThrow("not provided");
  });

  test("application pipes rethrow a lookup failure that is not a missing provider", () => {
    const container = {
      graph: {
        root: {},
        locate: () => {
          throw new Error("the graph refused the lookup");
        },
      },
    } as unknown as AponiaContainer;

    expect(() => resolveApplicationPipes(container)).toThrow("the graph refused the lookup");
  });

  test("executes pipe sequence", async () => {
    const pipe1 = resolvePipe(new ValidPipe());
    const metadata: ArgumentMetadata = { type: "param", data: "id" };

    const output = await executePipes([pipe1], "hello", metadata);
    expect(output).toBe("HELLO");
  });
});
