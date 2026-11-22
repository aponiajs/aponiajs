import { lookup } from "node:dns/promises";
import { AponiaError } from "@aponiajs/common";
import * as ipaddr from "ipaddr.js";

const blockedRanges = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "uniqueLocal",
  "carrierGradeNat",
  "reserved",
  "benchmarking",
  "documentation",
  "as112",
  "as112v6",
  "amt",
  "deprecated",
  "deprecatedOrchid",
  "discard",
  "orchid2",
  "rfc6052",
  "rfc6145",
  "segmentRouting",
  "6to4",
  "teredo",
]);

const blockedHostnames = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);

/** Throws when a URL is not safe for an outbound request. */
export async function assertPublicHttpUrl(
  url: URL,
  options: {
    readonly allowPrivateNetworks: boolean;
    readonly resolveAddresses: (hostname: string) => Promise<readonly string[]>;
  },
): Promise<void> {
  await resolvePublicHttpUrl(url, options);
}

/**
 * Validates a URL and answers the addresses the client may connect to.
 *
 * A literal hostname answers itself. A hostname answers every resolved address
 * after each one passed the blocked-range policy; the caller pins one of them
 * for the actual connection, which closes the DNS-rebinding window between this
 * check and the runtime's own resolution. `allowPrivateNetworks` answers an
 * empty list because no check or pinning applies.
 */
export async function resolvePublicHttpUrl(
  url: URL,
  options: {
    readonly allowPrivateNetworks: boolean;
    readonly resolveAddresses: (hostname: string) => Promise<readonly string[]>;
  },
): Promise<readonly string[]> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw blocked(url, "only http and https are allowed");
  }
  if (url.username !== "" || url.password !== "") {
    throw blocked(url, "credentials in a URL are not allowed");
  }
  if (options.allowPrivateNetworks) {
    return [];
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "" || blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw blocked(url, "the hostname is a local or metadata name");
  }

  if (isAddress(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw blocked(url, "the address is private, loopback, link-local, or reserved");
    }
    return [hostname];
  }

  let addresses: readonly string[];
  try {
    addresses = await options.resolveAddresses(hostname);
  } catch {
    throw blocked(url, "the hostname could not be resolved");
  }
  if (addresses.length === 0) {
    throw blocked(url, "the hostname resolved to no address");
  }
  for (const address of addresses) {
    if (!isAddress(address) || isBlockedAddress(address)) {
      throw blocked(
        url,
        "the hostname resolves to a private, loopback, link-local, or reserved address",
      );
    }
  }
  return addresses;
}

/** The default resolver, using the runtime's DNS lookup. */
export async function resolveHostname(hostname: string): Promise<readonly string[]> {
  const addresses = await lookup(hostname, { all: true });
  return addresses.map((address) => address.address);
}

/** A URL safe to include in an error: no query, credentials, or fragment. */
export function safeUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function isAddress(value: string): boolean {
  return ipaddr.isValid(value);
}

function isBlockedAddress(value: string): boolean {
  const parsed = ipaddr.process(value);
  if (blockedRanges.has(parsed.range())) {
    return true;
  }
  if (parsed.kind() !== "ipv6") {
    return false;
  }
  return isIpv4Compatible(parsed as ipaddr.IPv6);
}

/**
 * Whether an IPv6 address is the deprecated IPv4-compatible form.
 *
 * The first 96 bits are zero and the last 32 bits are an IPv4 address. The
 * unspecified and loopback forms are already covered by their own ranges, so
 * only an address that embeds a different IPv4 target is refused here.
 */
function isIpv4Compatible(address: ipaddr.IPv6): boolean {
  const bytes = address.toByteArray();
  for (let index = 0; index < 12; index += 1) {
    if (bytes[index] !== 0) {
      return false;
    }
  }
  const last = bytes[15] ?? 0;
  const previous = bytes[14] ?? 0;
  const beforePrevious = bytes[13] ?? 0;
  const firstOfLastWord = bytes[12] ?? 0;
  return firstOfLastWord !== 0 || beforePrevious !== 0 || previous !== 0 || last > 1;
}

function blocked(url: URL, reason: string): AponiaError {
  return new AponiaError("HTTP_CLIENT_BLOCKED", `The outbound request was blocked: ${reason}.`, {
    url: safeUrl(url),
    reason,
  });
}
