import {
  type ClassToken,
  type EnhancerMetadata,
  Catch,
  UseFilters,
  UseGuards,
  UseInterceptors,
  getCatchMetadata,
  getEnhancerMetadata,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

/**
 * The published decorator surface, pinned member by member. A later change that
 * widens `EnhancerMetadata`, narrows a decorator's accepted argument, or
 * changes what a read returns fails `bun run check`, which is the evidence this
 * type-only half carries.
 */
type EnhancerDecoratorAssertions = [
  Expect<Equals<keyof EnhancerMetadata, "guards" | "interceptors" | "filters">>,
  Expect<Equals<EnhancerMetadata["guards"], readonly ClassToken<unknown>[]>>,
  Expect<Equals<EnhancerMetadata["interceptors"], readonly ClassToken<unknown>[]>>,
  Expect<Equals<EnhancerMetadata["filters"], readonly ClassToken<unknown>[]>>,
  Expect<Equals<ReturnType<typeof UseGuards>, ClassDecorator & MethodDecorator>>,
  Expect<Equals<ReturnType<typeof UseInterceptors>, ClassDecorator & MethodDecorator>>,
  Expect<Equals<ReturnType<typeof UseFilters>, ClassDecorator & MethodDecorator>>,
  Expect<Equals<ReturnType<typeof Catch>, ClassDecorator>>,
  Expect<Equals<ReturnType<typeof getEnhancerMetadata>, EnhancerMetadata>>,
  Expect<Equals<ReturnType<typeof getCatchMetadata>, readonly ClassToken<unknown>[]>>,
];

class VitePlusAuthGuard {}
class VitePlusTimingInterceptor {}

@Catch(TypeError)
class VitePlusFilter {}

@UseGuards(VitePlusAuthGuard)
@UseInterceptors(VitePlusTimingInterceptor)
class VitePlusController {
  @UseFilters(VitePlusFilter)
  read(): string {
    return "read";
  }

  open(): string {
    return "open";
  }
}

test("the Vite+ lane records enhancer declarations written with decorator syntax", () => {
  const onClass: EnhancerMetadata = getEnhancerMetadata(VitePlusController);
  const onMethod: EnhancerMetadata = getEnhancerMetadata(VitePlusController, "read");

  expect(onClass.guards).toEqual([VitePlusAuthGuard]);
  expect(onClass.interceptors).toEqual([VitePlusTimingInterceptor]);
  expect(onMethod.filters).toEqual([VitePlusFilter]);
  expect(getEnhancerMetadata(VitePlusController, "open")).toEqual({
    guards: [],
    interceptors: [],
    filters: [],
  });
});

test("the Vite+ lane reads a filter's declared catch types from the filter's own class", () => {
  const assertions = Array.from({ length: 8 }, () => true) as EnhancerDecoratorAssertions;

  expect(assertions).toHaveLength(8);
  expect(getCatchMetadata(VitePlusFilter)).toEqual([TypeError]);
  expect(getCatchMetadata(VitePlusAuthGuard)).toEqual([]);
});
