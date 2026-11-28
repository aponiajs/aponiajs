import { VERSION_NEUTRAL, Version, getVersionMetadata, type VersionValue } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("records the neutral version marker", () => {
  class NeutralController {}

  Version(VERSION_NEUTRAL)(NeutralController);
  const value: VersionValue = VERSION_NEUTRAL;

  expect(getVersionMetadata(NeutralController)).toBe(VERSION_NEUTRAL);
  expect(typeof value).toBe("symbol");
});
