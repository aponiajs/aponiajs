import { AponiaError, isMessagePattern, maximumMessagePatternLength } from "@aponiajs/common";
import { decodeFirst, encode } from "cborg";
import {
  assertCborPreflight,
  maxEnvelopeBytes,
  maxEnvelopeDepth,
  maxEnvelopeItems,
} from "./cbor-preflight.ts";
import { microserviceEnvelopeVersion } from "./microservice-envelope.constants.ts";
import type {
  MicroserviceEnvelope,
  MicroserviceOutboundEnvelope,
  MicroserviceReplyEnvelope,
} from "./microservice-envelope.types.ts";

const maximumIdentifierLength = 128;
const maximumReplyDestinationLength = 2048;
const maximumFailureMessageLength = 1024;
const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Encodes one outbound request or event as a CBOR v1 envelope.
 *
 * The payload is passed through as-is; this function adds the version,
 * correlation identifier, target, and reply destination that let a server
 * answer it. It never logs or rewrites the payload.
 *
 * @param envelope - The request or event to encode.
 * @returns The encoded bytes a broker publishes.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_MESSAGE` when the envelope
 * or its payload cannot be represented within the wire contract.
 */
export function encodeMicroserviceEnvelope(envelope: MicroserviceOutboundEnvelope): Uint8Array {
  const validated = validatedOutbound(envelope);
  let bytes: Uint8Array;
  try {
    bytes = encode(validated);
  } catch {
    throw new AponiaError(
      "INVALID_MICROSERVICE_MESSAGE",
      "The microservice message payload cannot be encoded.",
      { kind: validated.kind },
    );
  }
  return finalizeEncoded(bytes, validated.kind);
}

/**
 * Encodes one reply as a CBOR v1 envelope.
 *
 * @param envelope - The successful or failed reply to encode.
 * @returns The encoded bytes a transport publishes to the request's reply destination.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_MESSAGE` when the reply cannot be represented.
 */
export function encodeMicroserviceReply(envelope: MicroserviceReplyEnvelope): Uint8Array {
  const validated = validatedReply(envelope);
  let bytes: Uint8Array;
  try {
    bytes = encode(validated);
  } catch {
    throw new AponiaError(
      "INVALID_MICROSERVICE_MESSAGE",
      "The microservice reply cannot be encoded.",
      { kind: "reply" },
    );
  }
  return finalizeEncoded(bytes, "reply");
}

/**
 * Bounds an encoded envelope by the same limits the decoder enforces, so the
 * framework never emits bytes it would refuse to accept from a broker.
 */
function finalizeEncoded(bytes: Uint8Array, kind: MicroserviceEnvelope["kind"]): Uint8Array {
  try {
    assertCborPreflight(bytes, {
      maxBytes: maxEnvelopeBytes,
      maxDepth: maxEnvelopeDepth,
      maxItems: maxEnvelopeItems,
    });
  } catch {
    throw new AponiaError(
      "INVALID_MICROSERVICE_MESSAGE",
      "The microservice envelope cannot be represented within the wire limits.",
      { kind },
    );
  }
  return bytes;
}

/**
 * Decodes and validates one CBOR v1 envelope.
 *
 * The structural preflight bounds size, item count, and nesting depth before
 * the decoder runs; validation then accepts exactly the declared fields for
 * the envelope kind and drops nothing silently. A malformed envelope never
 * reaches a handler and never produces a reply built from its contents.
 *
 * @param bytes - The bytes a broker delivered.
 * @returns The frozen, validated envelope.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_ENVELOPE` for any invalid input.
 */
export function decodeMicroserviceEnvelope(bytes: unknown): MicroserviceEnvelope {
  assertCborPreflight(bytes, {
    maxBytes: maxEnvelopeBytes,
    maxDepth: maxEnvelopeDepth,
    maxItems: maxEnvelopeItems,
  });

  let decoded: unknown;
  try {
    const [value, remainder] = decodeFirst(bytes);
    if (remainder.byteLength !== 0) {
      throw invalidEnvelope("an envelope must not carry trailing bytes");
    }
    decoded = value;
  } catch (error) {
    if (error instanceof AponiaError) {
      throw error;
    }
    throw invalidEnvelope("the envelope is not valid CBOR");
  }

  if (!isPlainRecord(decoded)) {
    throw invalidEnvelope("an envelope must be a CBOR map with string keys");
  }
  if (decoded.v !== microserviceEnvelopeVersion) {
    throw invalidEnvelope("an envelope must declare version 1");
  }
  const kind = decoded.kind;
  if (kind !== "request" && kind !== "event" && kind !== "reply") {
    throw invalidEnvelope('an envelope kind must be "request", "event", or "reply"');
  }

  switch (kind) {
    case "request":
      return validatedDecodedRequest(decoded);
    case "event":
      return validatedDecodedEvent(decoded);
    case "reply":
      return validatedDecodedReply(decoded);
  }
}

function validatedOutbound(envelope: MicroserviceOutboundEnvelope): MicroserviceOutboundEnvelope {
  if (!isPlainRecord(envelope)) {
    throw invalidMessage("an outbound envelope must be an object");
  }
  if (!Object.hasOwn(envelope, "data")) {
    throw invalidMessage("an outbound envelope must carry a data field");
  }
  assertIdentifier(envelope.id, "id", invalidMessage);
  assertPattern(envelope.pattern, invalidMessage);
  assertTarget(envelope.target, invalidMessage);
  if (envelope.kind === "request") {
    assertReplyDestination(envelope.replyTo, invalidMessage);
    return Object.freeze({
      v: microserviceEnvelopeVersion,
      kind: "request",
      id: envelope.id,
      pattern: envelope.pattern,
      data: envelope.data,
      target: envelope.target,
      replyTo: envelope.replyTo,
    });
  }
  if (envelope.kind === "event") {
    return Object.freeze({
      v: microserviceEnvelopeVersion,
      kind: "event",
      id: envelope.id,
      pattern: envelope.pattern,
      data: envelope.data,
      target: envelope.target,
    });
  }
  throw invalidMessage('an outbound envelope kind must be "request" or "event"');
}

function validatedReply(envelope: MicroserviceReplyEnvelope): MicroserviceReplyEnvelope {
  if (!isPlainRecord(envelope)) {
    throw invalidMessage("an outbound reply must be an object");
  }
  assertIdentifier(envelope.id, "id", invalidMessage);
  if (envelope.ok === true) {
    if (!Object.hasOwn(envelope, "value")) {
      throw invalidMessage("a successful reply must carry a value field");
    }
    return Object.freeze({
      v: microserviceEnvelopeVersion,
      kind: "reply",
      id: envelope.id,
      ok: true,
      value: envelope.value,
    });
  }
  if (envelope.ok === false) {
    const error = validateFailure(envelope.error, invalidMessage);
    return Object.freeze({
      v: microserviceEnvelopeVersion,
      kind: "reply",
      id: envelope.id,
      ok: false,
      error,
    });
  }
  throw invalidMessage("an outbound reply must state ok as a boolean");
}

function validatedDecodedRequest(value: Readonly<Record<string, unknown>>): MicroserviceEnvelope {
  assertExactKeys(value, ["v", "kind", "id", "pattern", "data", "target", "replyTo"]);
  assertIdentifier(value.id, "id", invalidEnvelope);
  assertPattern(value.pattern, invalidEnvelope);
  assertTarget(value.target, invalidEnvelope);
  assertReplyDestination(value.replyTo, invalidEnvelope);
  return Object.freeze({
    v: microserviceEnvelopeVersion,
    kind: "request" as const,
    id: value.id,
    pattern: value.pattern,
    data: value.data,
    target: value.target,
    replyTo: value.replyTo,
  });
}

function validatedDecodedEvent(value: Readonly<Record<string, unknown>>): MicroserviceEnvelope {
  assertExactKeys(value, ["v", "kind", "id", "pattern", "data", "target"]);
  assertIdentifier(value.id, "id", invalidEnvelope);
  assertPattern(value.pattern, invalidEnvelope);
  assertTarget(value.target, invalidEnvelope);
  return Object.freeze({
    v: microserviceEnvelopeVersion,
    kind: "event" as const,
    id: value.id,
    pattern: value.pattern,
    data: value.data,
    target: value.target,
  });
}

function validatedDecodedReply(value: Readonly<Record<string, unknown>>): MicroserviceEnvelope {
  assertIdentifier(value.id, "id", invalidEnvelope);
  if (value.ok === true) {
    assertExactKeys(value, ["v", "kind", "id", "ok", "value"]);
    return Object.freeze({
      v: microserviceEnvelopeVersion,
      kind: "reply" as const,
      id: value.id,
      ok: true as const,
      value: value.value,
    });
  }
  if (value.ok === false) {
    assertExactKeys(value, ["v", "kind", "id", "ok", "error"]);
    return Object.freeze({
      v: microserviceEnvelopeVersion,
      kind: "reply" as const,
      id: value.id,
      ok: false as const,
      error: validateFailure(value.error, invalidEnvelope),
    });
  }
  throw invalidEnvelope("a reply must state ok as a boolean");
}

function validateFailure(
  value: unknown,
  fail: (reason: string) => AponiaError,
): { readonly code: string; readonly message: string } {
  if (!isPlainRecord(value)) {
    throw fail("a failed reply must carry an error object");
  }
  for (const key of Object.keys(value)) {
    if (reservedKeys.has(key) || (key !== "code" && key !== "message")) {
      throw fail("a failed reply carries an unexpected field");
    }
  }
  if (!isBoundedNonEmptyString(value.code, maximumIdentifierLength)) {
    throw fail("a failure code must be a non-empty string of at most 128 characters");
  }
  if (!isBoundedNonEmptyString(value.message, maximumFailureMessageLength)) {
    throw fail("a failure message must be a non-empty string of at most 1024 characters");
  }
  return Object.freeze({ code: value.code, message: value.message });
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const permitted = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (reservedKeys.has(key) || !permitted.has(key)) {
      throw invalidEnvelope("an envelope carries an unexpected field");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw invalidEnvelope(`an envelope is missing the ${key} field`);
    }
  }
}

function assertIdentifier(
  value: unknown,
  field: string,
  fail: (reason: string) => AponiaError,
): asserts value is string {
  if (!isBoundedNonEmptyString(value, maximumIdentifierLength)) {
    throw fail(`an envelope ${field} must be a non-empty string of at most 128 characters`);
  }
}

function assertPattern(
  value: unknown,
  fail: (reason: string) => AponiaError,
): asserts value is string {
  if (!isMessagePattern(value)) {
    throw fail(
      `an envelope pattern must be a canonical alphanumeric key of at most ${maximumMessagePatternLength} characters`,
    );
  }
}

function assertTarget(
  value: unknown,
  fail: (reason: string) => AponiaError,
): asserts value is string {
  if (!isBoundedNonEmptyString(value, maximumIdentifierLength)) {
    throw fail("an envelope target must be a non-empty string of at most 128 characters");
  }
}

function assertReplyDestination(
  value: unknown,
  fail: (reason: string) => AponiaError,
): asserts value is string {
  if (!isBoundedNonEmptyString(value, maximumReplyDestinationLength)) {
    throw fail(
      "an envelope reply destination must be a non-empty string of at most 2048 characters",
    );
  }
}

function isBoundedNonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximumLength;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidEnvelope(reason: string): AponiaError {
  return new AponiaError(
    "INVALID_MICROSERVICE_ENVELOPE",
    `The microservice envelope is invalid: ${reason}.`,
    { reason },
  );
}

function invalidMessage(reason: string): AponiaError {
  return new AponiaError(
    "INVALID_MICROSERVICE_MESSAGE",
    `The microservice message is invalid: ${reason}.`,
    { reason },
  );
}

/** The two fields a server may answer a malformed request with. */
export interface MicroserviceRequestContext {
  /** The correlation identifier the failure reply answers. */
  readonly id: string;
  /** The destination the failure reply is published to. */
  readonly replyTo: string;
}

/**
 * Reads the correlation identifier and reply destination of one request.
 *
 * This is deliberately weaker than `decodeMicroserviceEnvelope`: a server
 * needs those two fields to answer a malformed request, but it must not act
 * on any other field. Only an envelope whose version, kind, identifier, and
 * `replyTo` pass the wire shape is read; every other input answers
 * `undefined`.
 *
 * @internal
 */
export function readMicroserviceRequestContext(
  bytes: unknown,
): MicroserviceRequestContext | undefined {
  try {
    assertCborPreflight(bytes, {
      maxBytes: maxEnvelopeBytes,
      maxDepth: maxEnvelopeDepth,
      maxItems: maxEnvelopeItems,
    });
    const [value, remainder] = decodeFirst(bytes);
    if (remainder.byteLength !== 0 || !isPlainRecord(value)) {
      return undefined;
    }
    if (value.v !== microserviceEnvelopeVersion || value.kind !== "request") {
      return undefined;
    }
    if (
      !isBoundedNonEmptyString(value.id, maximumIdentifierLength) ||
      !isBoundedNonEmptyString(value.replyTo, maximumReplyDestinationLength)
    ) {
      return undefined;
    }
    return Object.freeze({ id: value.id, replyTo: value.replyTo });
  } catch {
    return undefined;
  }
}
