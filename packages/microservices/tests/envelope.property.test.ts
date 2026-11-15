import { expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import fc from "fast-check";
import {
  decodeMicroserviceEnvelope,
  encodeMicroserviceEnvelope,
  type MicroserviceOutboundEnvelope,
} from "../src/index.ts";

const identifier = fc.stringMatching(/^[A-Za-z0-9._:-]{1,40}$/);
const canonicalPattern = fc
  .tuple(fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/), fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/))
  .map(([head, tail]) => `${head}.${tail}`);
// Numbers are integers on purpose: CBOR may encode a double in a narrower
// form, so an arbitrary float is not required to survive the wire byte-exactly.
const payload = fc.letrec((tie) => ({
  value: fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie("value"), { maxLength: 3 }),
    fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), tie("value"), { maxKeys: 3 }),
  ),
})).value as fc.Arbitrary<unknown>;

const outbound = fc.oneof(
  fc.record({
    kind: fc.constant("request" as const),
    id: identifier,
    pattern: canonicalPattern,
    data: payload,
    target: identifier,
    replyTo: identifier,
  }),
  fc.record({
    kind: fc.constant("event" as const),
    id: identifier,
    pattern: canonicalPattern,
    data: payload,
    target: identifier,
  }),
) as fc.Arbitrary<MicroserviceOutboundEnvelope>;

test("every outbound envelope the encoder accepts round-trips through the wire", () => {
  fc.assert(
    fc.property(outbound, (envelope) => {
      const decoded = decodeMicroserviceEnvelope(encodeMicroserviceEnvelope(envelope));

      expect(decoded).toEqual({ ...envelope, v: 1 });
    }),
    { numRuns: 200 },
  );
});

test("arbitrary bytes are refused with a typed error or decoded as an envelope, never crash", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
      try {
        const decoded = decodeMicroserviceEnvelope(bytes);
        expect(typeof decoded.kind).toBe("string");
      } catch (error) {
        expect(error).toBeInstanceOf(AponiaError);
        expect((error as AponiaError).code).toBe("INVALID_MICROSERVICE_ENVELOPE");
      }
    }),
    { numRuns: 300 },
  );
});
