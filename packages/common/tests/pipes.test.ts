import { describe, expect, test } from "bun:test";
import {
  Body,
  DefaultValuePipe,
  Param,
  ParseBoolPipe,
  ParseFloatPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UsePipes,
  getPipesMetadata,
  getRouteParameterMetadata,
  type ArgumentMetadata,
  type PipeTransform,
} from "../src/index.ts";

describe("Pipes in @aponiajs/common", () => {
  describe("ParseIntPipe", () => {
    const pipe = new ParseIntPipe();
    const metadata: ArgumentMetadata = { type: "param", data: "id" };

    test("transforms numeric string into an integer", () => {
      expect(pipe.transform("42", metadata)).toBe(42);
      expect(pipe.transform("0", metadata)).toBe(0);
      expect(pipe.transform("-15", metadata)).toBe(-15);
      expect(pipe.transform("  100  ", metadata)).toBe(100);
    });

    test("passes through number as integer", () => {
      expect(pipe.transform(42, metadata)).toBe(42);
      expect(pipe.transform(42.9, metadata)).toBe(42);
    });

    test("throws AponiaError with INVALID_PIPE_VALUE and status 400 for non-numeric string", () => {
      expect(() => pipe.transform("abc", metadata)).toThrow(
        expect.objectContaining({
          code: "INVALID_PIPE_VALUE",
          status: 400,
        }),
      );
    });

    test("respects custom exceptionFactory", () => {
      const customPipe = new ParseIntPipe({
        exceptionFactory: (msg) => new Error(`Custom: ${msg}`),
      });
      expect(() => customPipe.transform("not-a-number", metadata)).toThrow(
        "Custom: Validation failed (numeric string is expected)",
      );
    });
  });

  describe("ParseFloatPipe", () => {
    const pipe = new ParseFloatPipe();
    const metadata: ArgumentMetadata = { type: "query", data: "price" };

    test("transforms numeric string into a float", () => {
      expect(pipe.transform("42.5", metadata)).toBe(42.5);
      expect(pipe.transform("0.0", metadata)).toBe(0);
      expect(pipe.transform("-3.14", metadata)).toBe(-3.14);
    });

    test("throws AponiaError for invalid float", () => {
      expect(() => pipe.transform("invalid", metadata)).toThrow(
        expect.objectContaining({
          code: "INVALID_PIPE_VALUE",
          status: 400,
        }),
      );
    });
  });

  describe("ParseBoolPipe", () => {
    const pipe = new ParseBoolPipe();
    const metadata: ArgumentMetadata = { type: "query", data: "active" };

    test("transforms boolean strings", () => {
      expect(pipe.transform("true", metadata)).toBe(true);
      expect(pipe.transform("1", metadata)).toBe(true);
      expect(pipe.transform(true, metadata)).toBe(true);

      expect(pipe.transform("false", metadata)).toBe(false);
      expect(pipe.transform("0", metadata)).toBe(false);
      expect(pipe.transform(false, metadata)).toBe(false);
    });

    test("throws AponiaError for invalid boolean", () => {
      expect(() => pipe.transform("yes", metadata)).toThrow(
        expect.objectContaining({
          code: "INVALID_PIPE_VALUE",
          status: 400,
        }),
      );
    });
  });

  describe("ParseUUIDPipe", () => {
    const pipe = new ParseUUIDPipe();
    const metadata: ArgumentMetadata = { type: "param", data: "uuid" };

    test("accepts valid UUID v4", () => {
      const uuid = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
      expect(pipe.transform(uuid, metadata)).toBe(uuid);
    });

    test("throws AponiaError for invalid UUID", () => {
      expect(() => pipe.transform("123-abc", metadata)).toThrow(
        expect.objectContaining({
          code: "INVALID_PIPE_VALUE",
          status: 400,
        }),
      );
    });
  });

  describe("DefaultValuePipe", () => {
    const pipe = new DefaultValuePipe<unknown>(10);

    test("returns default when undefined or null", () => {
      expect(pipe.transform(undefined)).toBe(10);
      expect(pipe.transform(null)).toBe(10);
      expect(pipe.transform(Number.NaN)).toBe(10);
    });

    test("returns incoming value when provided", () => {
      expect(pipe.transform(5)).toBe(5);
      expect(pipe.transform("hello")).toBe("hello");
      expect(pipe.transform(false)).toBe(false);
    });
  });

  describe("@UsePipes decorator", () => {
    class CustomPipe implements PipeTransform {
      transform(val: unknown) {
        return val;
      }
    }

    @UsePipes(CustomPipe)
    class TestController {
      @UsePipes(ParseIntPipe)
      handle() {}
    }

    test("records pipe metadata on class and method", () => {
      const classPipes = getPipesMetadata(TestController);
      expect(classPipes).toEqual([CustomPipe]);

      const methodPipes = getPipesMetadata(TestController.prototype, "handle");
      expect(methodPipes).toEqual([ParseIntPipe]);
    });
  });

  describe("Parameter decorators with pipes", () => {
    class SampleController {
      findUser(
        @Param("id", ParseIntPipe) id: number,
        @Query("active", ParseBoolPipe) active: boolean,
        @Body(new DefaultValuePipe({})) body: unknown,
      ) {
        return { id, active, body };
      }
    }

    test("records pipes in parameter metadata", () => {
      const parameters = getRouteParameterMetadata(SampleController, "findUser");
      expect(parameters).toHaveLength(3);

      expect(parameters[0].kind).toBe("params");
      expect(parameters[0].property).toBe("id");
      expect(parameters[0].pipes).toEqual([ParseIntPipe]);

      expect(parameters[1].kind).toBe("query");
      expect(parameters[1].property).toBe("active");
      expect(parameters[1].pipes).toEqual([ParseBoolPipe]);

      expect(parameters[2].kind).toBe("body");
      expect(parameters[2].property).toBeUndefined();
      expect(parameters[2].pipes).toBeDefined();
      expect(parameters[2].pipes![0]).toBeInstanceOf(DefaultValuePipe);
    });
  });
});
