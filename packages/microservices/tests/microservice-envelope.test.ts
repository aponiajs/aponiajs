import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import { encode } from "cborg";
import {
  assertCborPreflight,
  maxEnvelopeBytes,
  maxEnvelopeDepth,
  maxEnvelopeItems,
} from "../src/envelope/cbor-preflight.ts";
import {
  decodeMicroserviceEnvelope,
  encodeMicroserviceEnvelope,
  encodeMicroserviceReply,
} from "../src/envelope/microservice-envelope.ts";

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function decodeFailure(bytes: unknown): AponiaError {
  try {
    decodeMicroserviceEnvelope(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    const failure = error as AponiaError;
    expect(failure.code).toBe("INVALID_MICROSERVICE_ENVELOPE");
    return failure;
  }
  throw new Error("Expected the envelope to be rejected.");
}

function encodeFailure(operation: () => unknown): AponiaError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    const failure = error as AponiaError;
    expect(failure.code).toBe("INVALID_MICROSERVICE_MESSAGE");
    return failure;
  }
  throw new Error("Expected the envelope to be rejected.");
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: "request",
    id: "request-1",
    pattern: "users.findOne",
    data: { id: "user-1" },
    target: "users",
    replyTo: "aponia/replies/client-1",
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: "event",
    id: "event-1",
    pattern: "users.created",
    data: { id: "user-1" },
    target: "users",
    ...overrides,
  };
}

function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: "reply",
    id: "request-1",
    ok: true,
    value: { id: "user-1" },
    ...overrides,
  };
}

describe("microservice envelope round trips", () => {
  test("round-trips a request with a structured payload", () => {
    const decoded = decodeMicroserviceEnvelope(
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "request",
        id: "request-1",
        pattern: "users.findOne",
        data: { nested: [1, "two", null, false, 0, { x: "y" }] },
        target: "users",
        replyTo: "aponia/replies/client-1",
      }),
    );

    expect(decoded).toEqual({
      v: 1,
      kind: "request",
      id: "request-1",
      pattern: "users.findOne",
      data: { nested: [1, "two", null, false, 0, { x: "y" }] },
      target: "users",
      replyTo: "aponia/replies/client-1",
    });
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  test("round-trips an event without a reply destination", () => {
    const decoded = decodeMicroserviceEnvelope(
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "event-1",
        pattern: "users.created",
        data: "payload",
        target: "users",
      }),
    );

    expect(decoded).toEqual({
      v: 1,
      kind: "event",
      id: "event-1",
      pattern: "users.created",
      data: "payload",
      target: "users",
    });
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  test("round-trips every successful reply value, including undefined", () => {
    for (const value of [undefined, null, false, 0, "", { ok: true }, [1, 2, 3]]) {
      const decoded = decodeMicroserviceEnvelope(
        encodeMicroserviceReply({ v: 1, kind: "reply", id: "request-1", ok: true, value }),
      );
      expect(decoded.kind).toBe("reply");
      if (decoded.kind !== "reply" || !decoded.ok) {
        throw new Error("Expected a successful reply.");
      }
      expect(Object.hasOwn(decoded, "value")).toBe(true);
      expect(decoded.value).toEqual(value);
    }
  });

  test("round-trips a failed reply with the client-safe failure only", () => {
    const decoded = decodeMicroserviceEnvelope(
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: false,
        error: { code: "MESSAGE_HANDLER_ERROR", message: "The handler failed." },
      }),
    );

    expect(decoded).toEqual({
      v: 1,
      kind: "reply",
      id: "request-1",
      ok: false,
      error: { code: "MESSAGE_HANDLER_ERROR", message: "The handler failed." },
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    if (decoded.kind === "reply" && !decoded.ok) {
      expect(Object.isFrozen(decoded.error)).toBe(true);
    }
  });
});

describe("microservice envelope encoding limits", () => {
  test("accepts identifiers at their documented boundary and rejects one more", () => {
    expect(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "i".repeat(128),
        pattern: "p".repeat(256),
        data: null,
        target: "t".repeat(128),
      }),
    ).not.toThrow();

    encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "i".repeat(129),
        pattern: "users.created",
        data: null,
        target: "users",
      }),
    );
    encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "id",
        pattern: "p".repeat(257),
        data: null,
        target: "users",
      }),
    );
    encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "id",
        pattern: "users.created",
        data: null,
        target: "t".repeat(129),
      }),
    );
    encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "request",
        id: "id",
        pattern: "users.findOne",
        data: null,
        target: "users",
        replyTo: "r".repeat(2049),
      }),
    );
    expect(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "request",
        id: "id",
        pattern: "users.findOne",
        data: null,
        target: "users",
        replyTo: `r${"r".repeat(2047)}`,
      }),
    ).not.toThrow();
  });

  test("rejects empty and whitespace-only identifiers", () => {
    for (const field of ["id", "pattern", "target"] as const) {
      encodeFailure(() =>
        encodeMicroserviceEnvelope({
          v: 1,
          kind: "event",
          id: "id",
          pattern: "users.created",
          data: null,
          target: "users",
          [field]: "   ",
        }),
      );
    }
    encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "request",
        id: "id",
        pattern: "users.findOne",
        data: null,
        target: "users",
        replyTo: "",
      }),
    );
  });

  test("rejects an outbound envelope without a data field", () => {
    const outgoing = {
      v: 1,
      kind: "event",
      id: "id",
      pattern: "users.created",
      target: "users",
    } as never;
    encodeFailure(() => encodeMicroserviceEnvelope(outgoing));
  });

  test("rejects a reply without a value field and a failure without an error", () => {
    encodeFailure(() =>
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: true,
      } as never),
    );
    encodeFailure(() =>
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: false,
      } as never),
    );
  });

  test("rejects an outbound envelope of an unsupported kind", () => {
    encodeFailure(() => encodeMicroserviceEnvelope(reply() as never));
    encodeFailure(() => encodeMicroserviceEnvelope({ ...event(), kind: "broadcast" } as never));
    encodeFailure(() => encodeMicroserviceEnvelope(null as never));
  });

  test("rejects a failure object with an unexpected field or invalid bounds", () => {
    encodeFailure(() =>
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: false,
        error: { code: "MESSAGE_HANDLER_ERROR", message: "m", stack: "internal" } as never,
      }),
    );
    encodeFailure(() =>
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: false,
        error: { code: "c".repeat(129), message: "m" },
      }),
    );
    encodeFailure(() =>
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: false,
        error: { code: "MESSAGE_HANDLER_ERROR", message: "m".repeat(1025) },
      }),
    );
    encodeFailure(() =>
      encodeMicroserviceReply({
        v: 1,
        kind: "reply",
        id: "request-1",
        ok: false,
        error: "failure" as never,
      }),
    );
  });

  test("rejects payloads larger than the envelope budget", () => {
    const failure = encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "id",
        pattern: "users.created",
        data: "x".repeat(maxEnvelopeBytes),
        target: "users",
      }),
    );
    expect(failure.details.kind).toBe("event");
  });

  test("rejects payloads nested beyond the decode depth budget", () => {
    let data: unknown = "leaf";
    for (let depth = 0; depth < maxEnvelopeDepth; depth += 1) {
      data = [data];
    }
    encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "id",
        pattern: "users.created",
        data,
        target: "users",
      }),
    );
  });

  test("rejects cyclic payloads without leaking the failure", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const failure = encodeFailure(() =>
      encodeMicroserviceEnvelope({
        v: 1,
        kind: "event",
        id: "id",
        pattern: "users.created",
        data: cyclic,
        target: "users",
      }),
    );
    expect(failure.message).not.toContain("self");
  });
});

describe("microservice envelope decoding", () => {
  test("rejects input that is not a Uint8Array", () => {
    for (const value of [undefined, null, "envelope", 42, {}, new ArrayBuffer(1)]) {
      expect(decodeFailure(value).details.reason).toContain("Uint8Array");
    }
  });

  test("rejects empty, oversized, truncated, and trailing input before decoding", () => {
    expect(decodeFailure(new Uint8Array()).details.reason).toContain("truncated");
    expect(decodeFailure(new Uint8Array(maxEnvelopeBytes + 1)).details.reason).toContain("exceed");

    const valid = encodeMicroserviceEnvelope({
      v: 1,
      kind: "event",
      id: "id",
      pattern: "users.created",
      data: null,
      target: "users",
    });
    const trailing = new Uint8Array(valid.byteLength + 1);
    trailing.set(valid);
    expect(decodeFailure(trailing).details.reason).toContain("trailing");
    expect(decodeFailure(valid.slice(0, valid.byteLength - 1)).details.reason).toMatch(
      /truncated|more bytes/,
    );
  });

  test("rejects a wrong version and an unknown kind", () => {
    expect(decodeFailure(encode(request({ v: 2 }))).details.reason).toContain("version");
    expect(decodeFailure(encode(request({ v: "1" }))).details.reason).toContain("version");
    expect(decodeFailure(encode(request({ kind: "broadcast" }))).details.reason).toContain("kind");
    expect(decodeFailure(encode({ ...request(), v: undefined }))).toBeInstanceOf(AponiaError);
  });

  test("rejects a root that is not a map", () => {
    for (const value of [null, 1, "text", true, [1, 2, 3]]) {
      expect(decodeFailure(encode(value)).details.reason).toContain("map");
    }
  });

  test("rejects missing, unexpected, and reserved fields", () => {
    const withoutData = request();
    delete withoutData.data;
    expect(decodeFailure(encode(withoutData)).details.reason).toContain("data");
    const withoutTarget = event();
    delete withoutTarget.target;
    expect(decodeFailure(encode(withoutTarget)).details.reason).toContain("target");
    expect(decodeFailure(encode(request({ extra: true }))).details.reason).toContain("unexpected");
    expect(decodeFailure(encode(event({ replyTo: "reply" }))).details.reason).toContain(
      "unexpected",
    );

    const reserved = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(event())) {
      reserved[key] = value;
    }
    reserved.__proto__ = 1;
    expect(decodeFailure(encode(reserved)).details.reason).toContain("unexpected");
  });

  test("rejects invalid identifiers and destinations", () => {
    for (const field of ["id", "pattern", "target", "replyTo"] as const) {
      const label = field === "replyTo" ? "reply destination" : field;
      expect(decodeFailure(encode(request({ [field]: "   " }))).details.reason).toContain(label);
      expect(decodeFailure(encode(request({ [field]: 7 }))).details.reason).toContain(label);
    }
    expect(decodeFailure(encode(request({ id: "i".repeat(129) }))).details.reason).toContain("id");
    expect(decodeFailure(encode(request({ pattern: "p".repeat(257) }))).details.reason).toContain(
      "pattern",
    );
    expect(decodeFailure(encode(request({ target: "t".repeat(129) }))).details.reason).toContain(
      "target",
    );
    expect(decodeFailure(encode(request({ replyTo: "r".repeat(2049) }))).details.reason).toContain(
      "reply destination",
    );
  });

  test("rejects malformed replies", () => {
    expect(decodeFailure(encode(reply({ ok: "yes" }))).details.reason).toContain("ok");
    const withoutValue = reply();
    delete withoutValue.value;
    expect(decodeFailure(encode(withoutValue)).details.reason).toContain("value");
    expect(
      decodeFailure(encode({ v: 1, kind: "reply", id: "request-1", value: 1 })).details.reason,
    ).toContain("ok");
    expect(
      decodeFailure(encode({ ...reply(), ok: false, error: { code: "C", message: "m" } })).details
        .reason,
    ).toContain("unexpected");

    for (const error of [
      { message: "m" },
      { code: "C" },
      { code: "", message: "m" },
      { code: "C", message: "" },
      { code: 1, message: "m" },
      { code: "C", message: 1 },
      { code: "C", message: "m", stack: "secret" },
      "failure",
      null,
    ]) {
      expect(
        decodeFailure(encode({ v: 1, kind: "reply", id: "request-1", ok: false, error })).details
          .reason,
      ).toBeTruthy();
    }
  });

  test("rejects tags and reserved headers", () => {
    expect(decodeFailure(hex("c000")).details.reason).toContain("tag");
    expect(decodeFailure(hex("1c")).details.reason).toContain("reserved");
    expect(decodeFailure(hex("ff")).details.reason).toContain("break");
  });

  test("rejects break markers and reserved headers inside containers", () => {
    expect(decodeFailure(hex("81ff")).details.reason).toContain("break");
    expect(decodeFailure(hex("a16161ff")).details.reason).toContain("break");
    expect(decodeFailure(hex("9f1cff")).details.reason).toContain("reserved");
  });

  test("rejects bytes the structural preflight accepts but the decoder cannot read", () => {
    // `81 1f` is one array whose element is a bare break marker: the preflight
    // counts it as an item, and cborg is the layer that refuses it.
    expect(decodeFailure(hex("811f")).details.reason).toContain("not valid CBOR");
  });

  test("rejects malformed indefinite strings", () => {
    expect(decodeFailure(hex("7f01ff")).details.reason).toContain("chunk");
    expect(decodeFailure(hex("7f6161")).details.reason).toContain("terminated");
    expect(decodeFailure(hex("7f6361ff")).details.reason).toContain("more bytes");
    expect(decodeFailure(hex("5f00ff")).details.reason).toContain("chunk");
  });

  test("rejects declarations that cannot fit the remaining bytes", () => {
    expect(decodeFailure(hex("9a7fffffff")).details.reason).toContain("array");
    expect(decodeFailure(hex("ba7fffffff")).details.reason).toContain("map");
    expect(decodeFailure(hex("7a7fffffff")).details.reason).toContain("string");
    expect(decodeFailure(hex("1bffffffffffffffff")).details.reason).toContain("length");
  });

  test("rejects truncated headers", () => {
    for (const value of ["18", "19", "1901", "1a", "1a0102", "1b", "1b01", "81"]) {
      expect(decodeFailure(hex(value)).details.reason).toMatch(/truncated|more bytes|declares/);
    }
  });

  test("enforces nesting depth at the documented boundary", () => {
    let accepted: Uint8Array = hex("01");
    for (let depth = 0; depth < maxEnvelopeDepth; depth += 1) {
      accepted = new Uint8Array([0x81, ...accepted]);
    }
    expect(() => assertCborPreflight(accepted)).not.toThrow();

    let rejected: Uint8Array = hex("01");
    for (let depth = 0; depth < maxEnvelopeDepth + 1; depth += 1) {
      rejected = new Uint8Array([0x81, ...rejected]);
    }
    expect(() => assertCborPreflight(rejected)).toThrow(/nest deeper/);
  });

  test("enforces the item budget on both defaults and custom limits", () => {
    const many = new Uint8Array([0x9f, ...Array.from({ length: 10 }, () => 0x01), 0xff]);
    expect(() =>
      assertCborPreflight(many, {
        maxBytes: 100,
        maxDepth: 8,
        maxItems: 4,
      }),
    ).toThrow(/more than 4 items/);
    expect(maxEnvelopeItems).toBeGreaterThan(1000);
    expect(() =>
      assertCborPreflight(encode(Array.from({ length: maxEnvelopeItems + 1 }, () => 0))),
    ).toThrow(/items/);
  });

  test("rejects oversized input under a custom byte limit", () => {
    expect(() =>
      assertCborPreflight(hex("0102"), { maxBytes: 1, maxDepth: 8, maxItems: 8 }),
    ).toThrow(/exceed/);
  });

  test("accepts indefinite containers and chunked strings at the preflight", () => {
    expect(() => assertCborPreflight(hex("9f01ff"))).not.toThrow();
    expect(() => assertCborPreflight(hex("bf616101ff"))).not.toThrow();
    expect(() => assertCborPreflight(hex("7f6161ff"))).not.toThrow();
    expect(() => assertCborPreflight(hex("5f4101ff"))).not.toThrow();
  });
});
