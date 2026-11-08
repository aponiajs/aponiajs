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
    tsconfig: "tsconfig.build.json",
    dts: true,
    exports: true,
    deps: {
      neverBundle: ["@aponiajs/common"],
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
