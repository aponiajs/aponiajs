import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/common": new URL("./packages/common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
    },
    globals: true,
    include: ["packages/*/tests-vp/**/*.conformance.ts"],
  },
  staged: {
    "*": "bun run check --fix",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
