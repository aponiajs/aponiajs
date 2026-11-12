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
  "amt",
  "deprecated",
  "orchid2",
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
  return blockedRanges.has(parsed.range());
}

function blocked(url: URL, reason: string): AponiaError {
  return new AponiaError("HTTP_CLIENT_BLOCKED", `The outbound request was blocked: ${reason}.`, {
    url: safeUrl(url),
    reason,
  });
}
