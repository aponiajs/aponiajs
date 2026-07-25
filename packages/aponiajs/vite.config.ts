import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests-vp/**/*.conformance.ts"],
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
