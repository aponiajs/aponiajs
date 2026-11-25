import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.conformance.ts"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
