import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests-vp/**/*.conformance.ts"],
  },
  pack: {
    dts: true,
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
