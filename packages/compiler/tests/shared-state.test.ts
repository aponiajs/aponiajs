import { describe, expect, test } from "bun:test";
import { defineModule } from "@aponiajs/common";
import { createContainer } from "@aponiajs/core";
import { provideSharedState, SharedStateService } from "../src/index.ts";

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition did not become true");
}

async function expectRejection(promise: Promise<unknown>, expected: object): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toMatchObject(expected);
    return;
  }
  throw new Error("Expected the operation to reject.");
}

describe("provideSharedState", () => {
  test("returns a frozen token, provider, and service", () => {
    const registration = provideSharedState({ count: 0 }, { label: "counter" });

    expect(Object.isFrozen(registration)).toBe(true);
    expect(registration.service).toBeInstanceOf(SharedStateService);
    expect(registration.service.label).toBe("counter");
    const provider = registration.provider as {
      readonly kind: string;
      readonly provide: unknown;
      readonly useValue: unknown;
    };
    expect(provider.kind).toBe("value");
    expect(provider.useValue).toBe(registration.service);
    expect(provider.provide).toBe(registration.token);
  });

  test("resolves through a container", () => {
    const registration = provideSharedState({ count: 0 }, { label: "counter" });
    const root = defineModule({
      id: "shared-root",
      providers: [registration.provider],
      exports: [registration.token],
    });
    const container = createContainer(root);

    expect(container.get(registration.token)).toBe(registration.service);
  });

  test("uses an existing token when one is supplied", () => {
    const first = provideSharedState({ count: 0 }, { token: undefined });
    const second = provideSharedState({ count: 0 }, { token: first.token });

    expect(second.token).toBe(first.token);
    expect(second.service).not.toBe(first.service);
  });
});

describe("SharedStateService", () => {
  test("reads and writes through the safe surface", () => {
    const registration = provideSharedState({ count: 0, nested: { label: "x" } });
    const service = registration.service;

    expect(service.read((state) => state.count)).toBe(0);
    service.write((state) => {
      state.count += 1;
      state.nested.label = "y";
    });

    expect(service.version).toBe(1);
    expect(service.read((state) => state.nested.label)).toBe("y");
  });

  test("concurrent async readers run together", async () => {
    const service = provideSharedState({ count: 1 }).service;
    const gate = deferred();
    const started: string[] = [];

    const first = service.readAsync(async (state) => {
      started.push("first");
      await gate.promise;
      return state.count;
    });
    const second = service.readAsync((state) => {
      started.push("second");
      return state.count;
    });

    await waitFor(() => started.length === 2);
    expect(await second).toBe(1);
    gate.resolve();
    expect(await first).toBe(1);
  });

  test("async writers serialize in arrival order", async () => {
    const service = provideSharedState({ count: 0 }).service;
    const gate = deferred();
    const order: string[] = [];

    const first = service.writeAsync(async (state) => {
      order.push("first-start");
      await gate.promise;
      state.count += 1;
      order.push("first-end");
    });
    await waitFor(() => order.includes("first-start"));

    const second = service.writeAsync((state) => {
      order.push("second");
      state.count += 1;
    });
    await waitFor(() => order.length === 1);
    expect(order).toEqual(["first-start"]);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(service.version).toBe(2);
  });

  test("a nested async writer fails immediately as self-reentrant", async () => {
    const service = provideSharedState({ count: 0 }, { label: "nested" }).service;

    await service.writeAsync(async () => {
      await expectRejection(
        service.writeAsync(() => undefined),
        {
          code: "BORROW_CONFLICT",
          details: expect.objectContaining({ reason: "self-reentrant", label: "nested" }),
        },
      );
    });
  });

  test("a queued async reader times out", async () => {
    const service = provideSharedState({ count: 0 }, { timeoutMs: 10 }).service;
    const gate = deferred();
    let started = false;
    const writer = service.writeAsync(async () => {
      started = true;
      await gate.promise;
    });
    await waitFor(() => started);

    await expectRejection(
      service.readAsync(() => 1),
      {
        code: "BORROW_CONFLICT",
        details: expect.objectContaining({ reason: "timeout", operation: "read" }),
      },
    );

    gate.resolve();
    await writer;
  });

  test("an aborted acquisition is refused", async () => {
    const service = provideSharedState({ count: 0 }).service;
    const controller = new AbortController();
    controller.abort();

    await expectRejection(
      service.writeAsync(() => undefined, { signal: controller.signal }),
      {
        code: "BORROW_CONFLICT",
        details: expect.objectContaining({ reason: "aborted" }),
      },
    );
  });
});
