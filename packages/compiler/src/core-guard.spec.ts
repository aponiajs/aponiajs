import { describe, expect, test } from "bun:test";
import {
  createToken,
  defineModule,
  provideClass,
  provideValue,
  type ControllerDefinition,
} from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";

describe("request-context lifetime guard", () => {
  test("a closed context refuses a request-scoped provider, controller, and create", () => {
    class RequestState {}
    class RequestController {}

    const provider = provideClass(RequestState, [], { scope: "request" });
    const root = defineModule({
      id: "guarded-root",
      providers: [provider],
      exports: [RequestState],
    });
    const container = createContainer(root);
    let open = true;
    const context = {};
    container.setRequestContextAccessor(
      () => context,
      () => open,
    );

    expect(container.get(RequestState, context)).toBeInstanceOf(RequestState);
    expect(
      container.instantiateController(
        root,
        {
          kind: "http",
          token: RequestController,
          inject: [],
          useClass: RequestController,
          scope: "request",
        } satisfies ControllerDefinition,
        context,
      ),
    ).toBeInstanceOf(RequestController);

    open = false;
    const stale = {
      code: "STALE_LIFETIME",
      details: expect.objectContaining({ reason: "closed" }),
    };
    expect(() => container.get(RequestState, context)).toThrow(expect.objectContaining(stale));
    expect(() => container.resolveModuleProvider(root, RequestState, context)).toThrow(
      expect.objectContaining(stale),
    );
    expect(() => container.createInModule(root, RequestState, context)).toThrow(
      expect.objectContaining(stale),
    );
    expect(() =>
      container.instantiateController(
        root,
        {
          kind: "http",
          token: RequestController,
          inject: [],
          useClass: RequestController,
          scope: "request",
        },
        context,
      ),
    ).toThrow(expect.objectContaining(stale));
  });

  test("an accessor without a guard keeps the compatibility behavior", () => {
    class RequestState {}
    const root = defineModule({
      id: "compat-root",
      providers: [provideClass(RequestState, [], { scope: "request" })],
      exports: [RequestState],
    });
    const container = createContainer(root);
    const context = {};
    container.setRequestContextAccessor(() => context);

    expect(container.get(RequestState, context)).toBeInstanceOf(RequestState);
  });

  test("a singleton still resolves with an ambient context", () => {
    const value = createToken<number>("value");
    const root = defineModule({
      id: "singleton-root",
      providers: [provideValue(value, 7)],
      exports: [value],
    });
    const container = createContainer(root);
    container.setRequestContextAccessor(
      () => ({}),
      () => false,
    );

    expect(container.get(value)).toBe(7);
  });
});
