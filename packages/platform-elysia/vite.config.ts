import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
    globals: true,
    include: ["test/**/*.conformance.ts"],
  },
  pack: {
    entry: {
      index: "src/index.ts",
      register: "src/compiler/register.ts",
    },
    tsconfig: "tsconfig.build.json",
    dts: true,
    exports: true,
    deps: {
      neverBundle: ["@aponiajs/common", "@aponiajs/core", "bun", "elysia"],
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
