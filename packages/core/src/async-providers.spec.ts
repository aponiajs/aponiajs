import { expect, test } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  forwardRef,
  provideFactory,
} from "@aponiajs/common";
import { createContainer } from "./index.ts";

const VALUE = createToken<number>("test.async.value");
const DERIVED = createToken<number>("test.async.derived");

test("the asynchronous pass awaits a factory and the providers that consume it", async () => {
  const root = defineModule({
    id: "AsyncRoot",
    providers: [
      provideFactory(VALUE, [], async () => 1),
      provideFactory(DERIVED, [VALUE], (value) => value + 1),
    ],
    exports: [VALUE, DERIVED],
  });
  const container = createContainer(root);

  await container.initializeModuleAsync(root);

  expect(container.get(VALUE)).toBe(1);
  expect(container.get(DERIVED)).toBe(2);
});

test("the synchronous path refuses a factory that was not awaited", () => {
  const root = defineModule({
    id: "AsyncRefusalRoot",
    providers: [provideFactory(VALUE, [], async () => 1)],
    exports: [VALUE],
  });
  const container = createContainer(root);

  let failure: unknown;
  try {
    container.get(VALUE);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AponiaError);
  expect((failure as AponiaError).code).toBe("ASYNC_PROVIDER_RESOLUTION");
});

test("an asynchronous factory is awaited once for every reader", async () => {
  let calls = 0;
  const root = defineModule({
    id: "AsyncOnceRoot",
    providers: [
      provideFactory(VALUE, [], async () => {
        calls += 1;
        return 1;
      }),
      provideFactory(DERIVED, [VALUE], (value) => value + 1),
    ],
    exports: [VALUE, DERIVED],
  });
  const container = createContainer(root);

  await container.initializeModuleAsync(root);
  await container.initializeModuleAsync(root);

  expect(calls).toBe(1);
  expect(container.get(DERIVED)).toBe(2);
});

test("an asynchronous boot keeps a forwardRef cycle lazy", async () => {
  const FIRST = createToken<{ readonly peer: unknown }>("test.async.first");
  const SECOND = createToken<{ readonly peer: unknown }>("test.async.second");

  const root = defineModule({
    id: "AsyncCycleRoot",
    providers: [
      provideFactory(FIRST, [forwardRef(() => SECOND)], (peer) => ({ peer })),
      provideFactory(SECOND, [forwardRef(() => FIRST)], (peer) => ({ peer })),
    ],
    exports: [FIRST, SECOND],
  });
  const container = createContainer(root);

  await container.initializeModuleAsync(root);

  expect(container.get(FIRST).peer).toBeDefined();
  expect(container.get(SECOND).peer).toBeDefined();
});
