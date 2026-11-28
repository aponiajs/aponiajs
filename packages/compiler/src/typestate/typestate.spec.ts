import { describe, expect, test } from "bun:test";
import { createStateMachine, once, Owned } from "../index.ts";

const definition = {
  initial: "draft",
  transitions: {
    draft: { publish: "published" },
    published: { archive: "archived" },
    archived: {},
  },
} as const;

describe("createStateMachine", () => {
  test("returns a new machine per transition and leaves the previous one unchanged", () => {
    const draft = createStateMachine(definition);

    expect(draft.state).toBe("draft");
    expect(draft.allowedEvents()).toEqual(["publish"]);
    expect(draft.can("publish")).toBe(true);
    expect(draft.can("archive")).toBe(false);

    const published = draft.transition("publish");
    expect(published.state).toBe("published");
    expect(published.allowedEvents()).toEqual(["archive"]);
    expect(draft.state).toBe("draft");

    const archived = published.transition("archive");
    expect(archived.state).toBe("archived");
    expect(archived.allowedEvents()).toEqual([]);
  });

  test("rejects a dynamic event with the from-state and allowed list", () => {
    const draft = createStateMachine(definition);
    const dynamic = draft as unknown as { transition(event: string): { readonly state: string } };

    expect(() => dynamic.transition("archive")).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE_TRANSITION",
        details: {
          from: "draft",
          event: "archive",
          allowed: ["publish"],
          reason: "unknown-event",
        },
      }),
    );
  });

  test("rejects an event a terminal state does not accept", () => {
    const archived = createStateMachine(definition, { from: "archived" });
    const dynamic = archived as unknown as { transition(event: string): unknown };

    expect(() => dynamic.transition("publish")).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE_TRANSITION",
        details: expect.objectContaining({ from: "archived", event: "publish", allowed: [] }),
      }),
    );
  });

  test("hydrates a declared state", () => {
    const machine = createStateMachine(definition, { from: "published" });

    expect(machine.state).toBe("published");
    expect(machine.transition("archive").state).toBe("archived");
  });

  test("rejects an unknown hydrated state", () => {
    expect(() => createStateMachine(definition, { from: "missing" })).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE_TRANSITION",
        details: expect.objectContaining({
          from: "missing",
          allowed: ["draft", "published", "archived"],
          reason: "unknown-state",
        }),
      }),
    );
  });

  test("rejects a definition whose target state is not declared", () => {
    expect(() =>
      createStateMachine({
        initial: "draft",
        transitions: { draft: { publish: "missing" } },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE_TRANSITION",
        details: expect.objectContaining({ from: "draft", event: "publish", target: "missing" }),
      }),
    );
  });

  test("rejects an empty definition and an undeclared initial state", () => {
    expect(() => createStateMachine({ initial: "draft", transitions: {} })).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
    );
    expect(() => createStateMachine({ initial: "draft", transitions: { published: {} } })).toThrow(
      expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
    );
  });
});

describe("Owned", () => {
  test("consumes exactly once", () => {
    const owned = new Owned({ id: 1 }, { label: "lease" });

    expect(owned.label).toBe("lease");
    expect(owned.consumed).toBe(false);
    expect(owned.peek()).toEqual({ id: 1 });
    expect(owned.consume()).toEqual({ id: 1 });
    expect(owned.consumed).toBe(true);
    expect(owned.peek()).toEqual({ id: 1 });
    expect(() => owned.consume()).toThrow(
      expect.objectContaining({
        code: "CONSUMED_STATE",
        details: { label: "lease", reason: "consumed" },
      }),
    );
  });

  test("disposes idempotently through both symbols", async () => {
    const sync = new Owned(1);
    sync[Symbol.dispose]();
    sync[Symbol.dispose]();
    expect(sync.consumed).toBe(true);
    expect(() => sync.consume()).toThrow(expect.objectContaining({ code: "CONSUMED_STATE" }));

    const async = new Owned(2);
    await async[Symbol.asyncDispose]();
    expect(async.consumed).toBe(true);
  });

  test("works with using declarations", async () => {
    {
      using lease = new Owned("value");
      expect(lease.peek()).toBe("value");
    }

    await (async () => {
      await using lease = new Owned("async");
      expect(lease.peek()).toBe("async");
    })();
  });
});

describe("once", () => {
  test("runs once with the original receiver and arguments", () => {
    const object = {
      value: 2,
      run: once(function (this: { value: number }, addend: number) {
        return this.value + addend;
      }),
    };

    expect(object.run(3)).toBe(5);
    expect(() => object.run(4)).toThrow(
      expect.objectContaining({
        code: "CONSUMED_STATE",
        details: expect.objectContaining({ reason: "consumed" }),
      }),
    );
  });

  test("wraps an async function and refuses a second call", async () => {
    const work = once(async (value: number) => value * 2);

    expect(await work(2)).toBe(4);
    expect(() => work(3)).toThrow(expect.objectContaining({ code: "CONSUMED_STATE" }));
  });
});

function invalidChainsAreCompileErrors(): void {
  const draft = createStateMachine(definition);
  // @ts-expect-error - "archive" is not accepted by the draft state
  draft.transition("archive");

  const published = draft.transition("publish");
  // @ts-expect-error - "publish" is not accepted by the published state
  published.transition("publish");
}
void invalidChainsAreCompileErrors;
