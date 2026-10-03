import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@aponiajs/platform-elysia": new URL("../platform-elysia/src/index.ts", import.meta.url)
        .pathname,
    },
    globals: true,
    include: ["tests-vp/**/*.conformance.ts"],
  },
  pack: {
    // The build reads a tsconfig without the workspace `paths` the test lane
    // needs. With them, the declaration emitter follows those mappings into the
    // other packages' sources and writes a `.d.ts` beside every file it finds.
    tsconfig: "tsconfig.build.json",
    dts: {
      tsgo: true,
      tsconfig: "tsconfig.build.json",
    },
    exports: true,
    deps: {
      neverBundle: ["@aponiajs/common", "@aponiajs/platform-elysia", "@elysia/cron", "elysia"],
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
