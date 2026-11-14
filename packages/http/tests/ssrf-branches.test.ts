import { expect, test } from "bun:test";
import { assertPublicHttpUrl, resolveHostname } from "../src/security/ssrf.ts";

const options = {
  allowPrivateNetworks: false,
  resolveAddresses: async () => ["93.184.216.34"],
};

test("accepts a public literal address without resolving it", async () => {
  expect(
    assertPublicHttpUrl(new URL("http://93.184.216.34/path"), {
      allowPrivateNetworks: false,
      resolveAddresses: async () => {
        throw new Error("must not resolve a literal address");
      },
    }),
  ).resolves.toBeUndefined();
});

test("refuses a resolver failure and an empty address list", async () => {
  expect(
    assertPublicHttpUrl(new URL("http://example.com"), {
      allowPrivateNetworks: false,
      resolveAddresses: async () => {
        throw new Error("dns failed");
      },
    }),
  ).rejects.toMatchObject({ code: "HTTP_CLIENT_BLOCKED" });

  expect(
    assertPublicHttpUrl(new URL("http://example.com"), {
      allowPrivateNetworks: false,
      resolveAddresses: async () => [],
    }),
  ).rejects.toMatchObject({ code: "HTTP_CLIENT_BLOCKED" });
});

test("resolves a hostname through the runtime DNS lookup", async () => {
  const addresses = await resolveHostname("localhost");
  expect(addresses.length).toBeGreaterThan(0);
});

test("accepts a public resolved hostname", async () => {
  expect(assertPublicHttpUrl(new URL("https://example.com"), options)).resolves.toBeUndefined();
});
