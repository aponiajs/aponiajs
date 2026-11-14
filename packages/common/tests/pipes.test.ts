import { describe, expect, test } from "bun:test";
import {
  Body,
  DefaultValuePipe,
  Param,
  ParseArrayPipe,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseFilePipe,
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

    test("passes through a number and respects custom exceptionFactory", () => {
      expect(pipe.transform(42.5, metadata)).toBe(42.5);

      const customPipe = new ParseFloatPipe({
        exceptionFactory: (msg) => new Error(`Custom: ${msg}`),
      });
      expect(() => customPipe.transform("invalid", metadata)).toThrow(
        "Custom: Validation failed (numeric string is expected)",
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

    test("respects custom exceptionFactory", () => {
      const customPipe = new ParseBoolPipe({
        exceptionFactory: (msg) => new Error(`Custom: ${msg}`),
      });
      expect(() => customPipe.transform("yes", metadata)).toThrow(
        "Custom: Validation failed (boolean string is expected)",
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

    test("respects custom exceptionFactory", () => {
      const customPipe = new ParseUUIDPipe({
        exceptionFactory: (msg) => new Error(`Custom: ${msg}`),
      });
      expect(() => customPipe.transform("123-abc", metadata)).toThrow(
        "Custom: Validation failed (uuid is expected)",
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

  describe("ParseEnumPipe", () => {
    enum Status {
      Active = "active",
      Paused = "paused",
    }

    const metadata: ArgumentMetadata = { type: "query", data: "status" };

    test("accepts a member of an enum object, an array, and a numeric enum", () => {
      expect(new ParseEnumPipe(Status).transform("active", metadata)).toBe("active");
      expect(new ParseEnumPipe(["a", "b"] as const).transform("b", metadata)).toBe("b");

      enum Level {
        Low = 1,
        High = 2,
      }
      const numeric = new ParseEnumPipe(Level);
      expect(numeric.transform("2", metadata)).toBe("2");
      expect(numeric.transform(2, metadata)).toBe(2);
    });

    test("rejects a value outside the declared set", () => {
      const pipe = new ParseEnumPipe(Status);
      expect(() => pipe.transform("unknown", metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE", status: 400 }),
      );
      expect(() => pipe.transform(1, metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE" }),
      );
      expect(() => pipe.transform(undefined, metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE" }),
      );
    });

    test("respects a custom status and exceptionFactory", () => {
      const pipe = new ParseEnumPipe(Status, { errorHttpStatusCode: 422 });
      expect(() => pipe.transform("unknown", metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE", status: 422 }),
      );

      const custom = new ParseEnumPipe(Status, {
        exceptionFactory: (message) => new Error(`Custom: ${message}`),
      });
      expect(() => custom.transform("unknown", metadata)).toThrow(
        "Custom: Validation failed (enum value is expected)",
      );
    });
  });

  describe("ParseArrayPipe", () => {
    const metadata: ArgumentMetadata = { type: "query", data: "tags" };

    test("splits a delimited string and drops empty segments", () => {
      const pipe = new ParseArrayPipe();
      expect(pipe.transform("a, b ,c", metadata)).toEqual(["a", "b", "c"]);
      expect(pipe.transform("a,,b", metadata)).toEqual(["a", "b"]);
      expect(pipe.transform("", metadata)).toEqual([]);
      expect(pipe.transform("   ", metadata)).toEqual([]);
    });

    test("honours a custom separator", () => {
      expect(new ParseArrayPipe({ separator: "|" }).transform("a|b", metadata)).toEqual(["a", "b"]);
    });

    test("copies an array, trims string items, and freezes the result", () => {
      const result = new ParseArrayPipe().transform([" a ", 2], metadata);

      expect(result).toEqual(["a", 2]);
      expect(Object.isFrozen(result)).toBe(true);
    });

    test("rejects a value that is neither a string nor an array", () => {
      expect(() => new ParseArrayPipe().transform(42, metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE", status: 400 }),
      );
    });
  });

  describe("ParseFilePipe", () => {
    const metadata: ArgumentMetadata = { type: "body", data: "file" };
    const file = { name: "notes.txt", size: 10, type: "text/plain" };

    test("accepts a file within the declared limits", () => {
      expect(new ParseFilePipe().transform(file, metadata)).toBe(file);
      expect(
        new ParseFilePipe({ maxSize: 10, mimetype: "text/plain" }).transform(file, metadata),
      ).toBe(file);
      expect(new ParseFilePipe({ mimetype: /^text\// }).transform(file, metadata)).toBe(file);
      expect(
        new ParseFilePipe({ mimetype: ["image/png", "text/plain"] }).transform(file, metadata),
      ).toBe(file);
    });

    test("requires a file unless the option says otherwise", () => {
      expect(() => new ParseFilePipe().transform(undefined, metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE", status: 400 }),
      );

      const optional = new ParseFilePipe({ fileIsRequired: false });
      expect(optional.transform(undefined, metadata)).toBeUndefined();
      expect(optional.transform(null, metadata)).toBeUndefined();
    });

    test("rejects a value that is not a file", () => {
      expect(() => new ParseFilePipe().transform({ name: "x" }, metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE" }),
      );
      expect(() => new ParseFilePipe().transform("file", metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE" }),
      );
    });

    test("rejects an oversized file", () => {
      expect(() => new ParseFilePipe({ maxSize: 5 }).transform(file, metadata)).toThrow(
        expect.objectContaining({ code: "INVALID_PIPE_VALUE", status: 400 }),
      );
    });

    test("rejects a disallowed media type", () => {
      for (const mimetype of ["image/png", /^image\//, ["image/png", "image/jpeg"]]) {
        expect(() => new ParseFilePipe({ mimetype }).transform(file, metadata)).toThrow(
          expect.objectContaining({ code: "INVALID_PIPE_VALUE" }),
        );
      }
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
