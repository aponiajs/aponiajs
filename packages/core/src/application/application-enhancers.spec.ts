import { expect, test } from "bun:test";
import {
  APP_FILTER,
  APP_INTERCEPTOR,
  APP_PIPE,
  Catch,
  defineModule,
  provideClass,
  provideValue,
  type ExceptionFilter,
  type Interceptor,
  type PipeTransform,
  type Provider,
} from "@aponiajs/common";
import { createContainer } from "../injector/container.ts";
import {
  resolveApplicationFilters,
  resolveApplicationInterceptors,
  resolveApplicationPipeOccurrences,
} from "./application-enhancers.ts";

/**
 * The application-wide enhancer collection a neutral platform's boot performs.
 * The container is built from a declared module graph, so no HTTP runtime is
 * involved; each case asserts what the boot would resolve and in what order.
 */

class FirstInterceptor implements Interceptor {
  interceptBefore(): void {}
}

class SecondInterceptor implements Interceptor {
  interceptAfter(): void {}
}

@Catch(RangeError)
class RangedFilter implements ExceptionFilter {
  catch(): undefined {
    return undefined;
  }
}

class PassThroughPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}

const instanceFilter = {
  catch(): undefined {
    return undefined;
  },
};

function containerWith(providers: readonly Provider[]): ReturnType<typeof createContainer> {
  const root = defineModule({ id: "ApplicationEnhancersSpec", providers: providers as never });
  return createContainer(root);
}

test("collects interceptors in declaration order and resolves a class in its module", () => {
  const container = containerWith([
    provideClass(APP_INTERCEPTOR, FirstInterceptor, []),
    provideClass(APP_INTERCEPTOR, SecondInterceptor, []),
  ]);

  const interceptors = resolveApplicationInterceptors(container);

  expect(interceptors).toHaveLength(2);
  expect(interceptors[0]).toBeInstanceOf(FirstInterceptor);
  expect(interceptors[1]).toBeInstanceOf(SecondInterceptor);
});

test("collects filters with the catch metadata each class declared", () => {
  const container = containerWith([
    provideClass(APP_FILTER, RangedFilter, []),
    provideValue(APP_FILTER, instanceFilter),
  ]);

  const filters = resolveApplicationFilters(container);

  expect(filters).toHaveLength(2);
  expect(filters[0]?.instance).toBeInstanceOf(RangedFilter);
  expect(filters[0]?.catch).toEqual([RangeError]);
  // An instance entry reads its constructor, which declared no catch type.
  expect(filters[1]?.instance).toBe(instanceFilter);
  expect(filters[1]?.catch).toEqual([]);
});

test("ignores a declaration that resolved to nothing", () => {
  const container = containerWith([provideValue(APP_PIPE, undefined as never)]);

  expect(resolveApplicationPipeOccurrences(container)).toEqual([]);
});

test("collects pipes in declaration order without resolving them", () => {
  const container = containerWith([provideClass(APP_PIPE, PassThroughPipe, [])]);

  const pipes = resolveApplicationPipeOccurrences(container);

  expect(pipes).toHaveLength(1);
  expect(pipes[0]?.entry).toBeInstanceOf(PassThroughPipe);
});
