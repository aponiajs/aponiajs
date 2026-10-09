import { z } from "zod";
import { createDto, type Infer } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const describe: VitePlusTest["describe"];
declare const expect: VitePlusTest["expect"];
declare const it: VitePlusTest["it"];

describe("createDto Conformance", () => {
  it("preserves static schema and instance types across bundlers", () => {
    const Schema = z.object({ value: z.number() });
    class MetricDto extends createDto(Schema) {}
    type Metric = Infer<typeof Schema>;
    const sample: Metric = { value: 42 };
    expect(sample.value).toBe(42);
    expect(MetricDto.schema).toBe(Schema);
  });
});
