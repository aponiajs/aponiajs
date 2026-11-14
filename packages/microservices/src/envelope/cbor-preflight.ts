import { AponiaError } from "@aponiajs/common";

/** The default maximum encoded envelope size, in bytes. */
export const maxEnvelopeBytes = 1024 * 1024;

/** The default maximum structure depth an envelope may contain. */
export const maxEnvelopeDepth = 32;

/**
 * The maximum number of CBOR items an envelope may contain.
 *
 * A byte limit alone does not bound the work a decoder performs: nested
 * one-byte arrays can describe many more items than their own size suggests,
 * and each costs a decode step. The item budget is deliberately generous for
 * ordinary data and orders of magnitude below a denial-of-service payload.
 */
export const maxEnvelopeItems = 100_000;

/** The limits the structural preflight enforces before decoding. */
export interface CborPreflightLimits {
  /** The maximum encoded size in bytes. */
  readonly maxBytes: number;
  /** The maximum nesting depth. */
  readonly maxDepth: number;
  /** The maximum number of items. */
  readonly maxItems: number;
}

const defaultLimits: CborPreflightLimits = Object.freeze({
  maxBytes: maxEnvelopeBytes,
  maxDepth: maxEnvelopeDepth,
  maxItems: maxEnvelopeItems,
});

/**
 * Rejects bytes whose CBOR structure exceeds the envelope limits.
 *
 * The check walks item headers without decoding values, so a declared length
 * or nesting depth cannot cause the decoder to allocate or recurse before it
 * has been bounded. It rejects tags, indefinite strings nested through
 * unsupported shapes, trailing bytes, and every truncated input.
 *
 * @param bytes - The candidate envelope bytes.
 * @param limits - The structural limits to enforce.
 * @throws `AponiaError` with `INVALID_MICROSERVICE_ENVELOPE` when the structure is unsafe.
 */
export function assertCborPreflight(
  bytes: unknown,
  limits: CborPreflightLimits = defaultLimits,
): asserts bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw invalidEnvelope("an envelope must be a Uint8Array");
  }
  if (bytes.byteLength > limits.maxBytes) {
    throw invalidEnvelope(`an envelope must not exceed ${limits.maxBytes} bytes`);
  }
  scan(bytes, limits);
}

interface Frame {
  remaining: number;
  readonly depth: number;
}

interface Header {
  readonly major: number;
  readonly additional: number;
  readonly length: number;
  readonly value: number;
  readonly indefinite: boolean;
}

function scan(bytes: Uint8Array, limits: CborPreflightLimits): void {
  const frames: Frame[] = [{ remaining: 1, depth: 0 }];
  let offset = 0;
  let items = 0;
  let maximumDepth = 0;

  while (frames.length > 0) {
    const frame = frames[frames.length - 1]!;
    if (frame.remaining === 0) {
      frames.pop();
      continue;
    }
    if (frame.remaining > 0) {
      frame.remaining -= 1;
    }
    if (offset >= bytes.byteLength) {
      throw invalidEnvelope("the envelope structure is truncated");
    }

    const header = readHeader(bytes, offset);
    offset += header.length;
    items = countItem(items, limits);

    if (header.major === 7 && header.additional === 31) {
      if (frame.remaining !== -1) {
        throw invalidEnvelope("a break marker closes no indefinite container");
      }
      frames.pop();
      continue;
    }

    switch (header.major) {
      case 0:
      case 1:
        break;
      case 2:
      case 3:
        if (header.indefinite) {
          const scanned = scanIndefiniteString(bytes, offset, header.major, limits, items);
          offset = scanned.offset;
          items = scanned.items;
        } else {
          if (header.value > bytes.byteLength - offset) {
            throw invalidEnvelope("a string declares more bytes than the envelope holds");
          }
          offset += header.value;
        }
        break;
      case 4:
        if (header.indefinite) {
          frames.push({ remaining: -1, depth: frame.depth + 1 });
        } else {
          if (header.value > bytes.byteLength - offset) {
            throw invalidEnvelope("an array declares more items than the envelope can hold");
          }
          if (header.value > 0) {
            frames.push({ remaining: header.value, depth: frame.depth + 1 });
          }
        }
        maximumDepth = Math.max(maximumDepth, frame.depth + 1);
        break;
      case 5: {
        if (header.indefinite) {
          frames.push({ remaining: -1, depth: frame.depth + 1 });
        } else {
          const pairs = header.value;
          if (pairs > Math.floor((bytes.byteLength - offset) / 2)) {
            throw invalidEnvelope("a map declares more entries than the envelope can hold");
          }
          if (pairs > 0) {
            frames.push({ remaining: pairs * 2, depth: frame.depth + 1 });
          }
        }
        maximumDepth = Math.max(maximumDepth, frame.depth + 1);
        break;
      }
      case 6:
        throw invalidEnvelope("timestamps and other CBOR tags are not part of the envelope");
      case 7:
        break;
      default:
        throw invalidEnvelope("the envelope contains an unsupported CBOR major type");
    }

    if (maximumDepth > limits.maxDepth) {
      throw invalidEnvelope(`an envelope must not nest deeper than ${limits.maxDepth} levels`);
    }
  }

  if (offset !== bytes.byteLength) {
    throw invalidEnvelope("an envelope must not carry trailing bytes");
  }
}

function scanIndefiniteString(
  bytes: Uint8Array,
  start: number,
  major: number,
  limits: CborPreflightLimits,
  startItems: number,
): { readonly offset: number; readonly items: number } {
  let offset = start;
  let items = startItems;
  while (true) {
    if (offset >= bytes.byteLength) {
      throw invalidEnvelope("an indefinite string is not terminated");
    }
    const header = readHeader(bytes, offset);
    offset += header.length;
    items = countItem(items, limits);
    if (header.major === 7 && header.additional === 31) {
      return { offset, items };
    }
    if (header.major !== major || header.indefinite) {
      throw invalidEnvelope("an indefinite string carries a chunk of another type");
    }
    if (header.value > bytes.byteLength - offset) {
      throw invalidEnvelope("a string chunk declares more bytes than the envelope holds");
    }
    offset += header.value;
  }
}

function countItem(items: number, limits: CborPreflightLimits): number {
  const next = items + 1;
  if (next > limits.maxItems) {
    throw invalidEnvelope(`an envelope must not contain more than ${limits.maxItems} items`);
  }
  return next;
}

function readHeader(bytes: Uint8Array, offset: number): Header {
  const initial = bytes[offset]!;
  const major = initial >> 5;
  const additional = initial & 0x1f;
  if (additional < 24) {
    return { major, additional, length: 1, value: additional, indefinite: false };
  }
  if (additional === 24) {
    requireBytes(bytes, offset, 2);
    return { major, additional, length: 2, value: bytes[offset + 1]!, indefinite: false };
  }
  if (additional === 25) {
    requireBytes(bytes, offset, 3);
    return {
      major,
      additional,
      length: 3,
      value: (bytes[offset + 1]! << 8) | bytes[offset + 2]!,
      indefinite: false,
    };
  }
  if (additional === 26) {
    requireBytes(bytes, offset, 5);
    return {
      major,
      additional,
      length: 5,
      value:
        bytes[offset + 1]! * 0x1000000 +
        bytes[offset + 2]! * 0x10000 +
        bytes[offset + 3]! * 0x100 +
        bytes[offset + 4]!,
      indefinite: false,
    };
  }
  if (additional === 27) {
    requireBytes(bytes, offset, 9);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const value = view.getBigUint64(offset + 1);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidEnvelope("a length does not fit the envelope limits");
    }
    return { major, additional, length: 9, value: Number(value), indefinite: false };
  }
  if (additional === 31) {
    return { major, additional, length: 1, value: -1, indefinite: true };
  }
  throw invalidEnvelope("the envelope contains a reserved CBOR header");
}

function requireBytes(bytes: Uint8Array, offset: number, length: number): void {
  if (offset + length > bytes.byteLength) {
    throw invalidEnvelope("the envelope structure is truncated");
  }
}

function invalidEnvelope(reason: string): AponiaError {
  return new AponiaError(
    "INVALID_MICROSERVICE_ENVELOPE",
    `The microservice envelope is invalid: ${reason}.`,
    { reason },
  );
}
