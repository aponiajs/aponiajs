import {
  AsyncRwLock,
  createStateMachine,
  LifetimeScope,
  once,
  Owned,
  provideSharedState,
  RwCell,
  type DeepReadonly,
  type Scoped,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

const machineDefinition = {
  initial: "draft",
  transitions: {
    draft: { publish: "published" },
    published: { archive: "archived" },
    archived: {},
  },
} as const;

const draft = createStateMachine(machineDefinition);

type _ScopedIsNotItsValue = Expect<
  Equals<Scoped<{ id: number }> extends { id: number } ? true : false, false>
>;
type _InitialStateIsLiteral = Expect<Equals<typeof draft.state, "draft">>;
type _ReadViewIsDeepReadonly = Expect<
  Equals<
    DeepReadonly<{ nested: { value: number } }>,
    { readonly nested: { readonly value: number } }
  >
>;
void (undefined as unknown as _ScopedIsNotItsValue);
void (undefined as unknown as _InitialStateIsLiteral);
void (undefined as unknown as _ReadViewIsDeepReadonly);

test("a lifetime handle refuses a read after exit", () => {
  const scope = new LifetimeScope({ label: "request" });
  const handle = scope.track("value");

  expect(handle.get()).toBe("value");
  scope.exit("response");
  expect(() => handle.get()).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
});

test("a read view is revoked after its borrow releases", () => {
  const cell = new RwCell({ count: 0 });
  let view: DeepReadonly<{ count: number }> | undefined;

  cell.read((state) => {
    view = state;
    expect(() => {
      (state as { count: number }).count = 1;
    }).toThrow(expect.objectContaining({ code: "READONLY_VIEW" }));
  });

  expect(() => view?.count).toThrow(expect.objectContaining({ code: "STALE_LIFETIME" }));
});

test("a state machine returns a new machine and rejects a dynamic event", () => {
  const published = draft.transition("publish");

  expect(published.state).toBe("published");
  expect(draft.state).toBe("draft");
  expect(() =>
    (draft as unknown as { transition(event: string): unknown }).transition("archive"),
  ).toThrow(expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }));
});

test("linear consumption refuses reuse", () => {
  const owned = new Owned("value");
  const release = once(() => "released");

  expect(owned.consume()).toBe("value");
  expect(() => owned.consume()).toThrow(expect.objectContaining({ code: "CONSUMED_STATE" }));
  expect(release()).toBe("released");
  expect(() => release()).toThrow(expect.objectContaining({ code: "CONSUMED_STATE" }));
});

test("an async lock runs readers concurrently and queues writers", async () => {
  const lock = new AsyncRwLock({ label: "shared" });
  const order: string[] = [];

  await lock.read(async () => {
    order.push("read");
  });
  await lock.write(() => {
    order.push("write");
  });

  expect(order).toEqual(["read", "write"]);
});

test("shared state exposes only the safe surface", () => {
  const registration = provideSharedState({ count: 0 }, { label: "counter" });

  registration.service.write((state) => {
    state.count += 1;
  });

  expect(registration.service.read((state) => state.count)).toBe(1);
  expect(registration.token).toBe(registration.provider.provide);
});
