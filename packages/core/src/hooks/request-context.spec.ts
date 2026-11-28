import { afterEach, expect, test } from "bun:test";
import {
  ContextIdFactory,
  REQUEST_CONTEXT_ID,
  attachRequestContextId,
  type ContextId,
} from "../index.ts";

/**
 * The context-id factory's strategy seam and the request annotation a platform
 * writes. Each case installs at most one process-wide strategy and removes it
 * afterwards, because the registration is global by contract.
 */

afterEach(() => {
  ContextIdFactory.reset();
});

test("answers a fresh id for a request when no strategy is registered", () => {
  ContextIdFactory.reset();
  const id = ContextIdFactory.getByRequest({});

  expect(typeof id.id).toBe("number");
  expect(id.getParent).toBeUndefined();
});

test("answers a fresh id when the strategy attaches nothing", () => {
  ContextIdFactory.apply({ attach: () => undefined });

  const id = ContextIdFactory.getByRequest({});

  expect(typeof id.id).toBe("number");
  expect(id.getParent).toBeUndefined();
});

test("a strategy that attaches a resolver function records it as the parent resolver", () => {
  const parent: ContextId = { id: "parent" };
  ContextIdFactory.apply({ attach: () => () => parent });

  const id = ContextIdFactory.getByRequest({});
  const resolved = id.getParent?.({ token: "token", isTreeDurable: true });

  expect(resolved).toBe(parent);
});

test("a strategy that attaches a resolver and payload records both", () => {
  const parent: ContextId = { id: 7 };
  ContextIdFactory.apply({
    attach: () => ({ resolve: () => parent, payload: { tenant: "acme" } }),
  });

  const id = ContextIdFactory.getByRequest({});

  expect(id.payload).toEqual({ tenant: "acme" });
  expect(id.getParent?.({ token: "token", isTreeDurable: true })).toBe(parent);
});

test("an id a platform recorded on the request wins over a fresh one", () => {
  const recorded: ContextId = { id: "recorded" };
  const request = attachRequestContextId({ marker: true }, recorded);

  expect(ContextIdFactory.getByRequest(request)).toBe(recorded);
  const descriptor = Object.getOwnPropertyDescriptor(request, REQUEST_CONTEXT_ID);
  expect(descriptor).toMatchObject({
    value: recorded,
    enumerable: false,
    writable: false,
    configurable: false,
  });
});

test("an id nested under an inspected request property is read", () => {
  const nested: ContextId = { id: "nested" };
  ContextIdFactory.apply({ attach: () => undefined });

  expect(ContextIdFactory.getByRequest({ raw: { [REQUEST_CONTEXT_ID]: nested } })).toBe(nested);
});
