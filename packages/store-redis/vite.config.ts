import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/common": new URL("../common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("../core/src/index.ts", import.meta.url).pathname,
      "@aponiajs/cache": new URL("../cache/src/index.ts", import.meta.url).pathname,
      "@aponiajs/rate-limit": new URL("../rate-limit/src/index.ts", import.meta.url).pathname,
      "@aponiajs/session": new URL("../session/src/index.ts", import.meta.url).pathname,
      "@aponiajs/idempotency": new URL("../idempotency/src/index.ts", import.meta.url).pathname,
      "@aponiajs/auth": new URL("../auth/src/index.ts", import.meta.url).pathname,
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
      neverBundle: [
        "@aponiajs/common",
        "@aponiajs/cache",
        "@aponiajs/rate-limit",
        "@aponiajs/session",
        "@aponiajs/idempotency",
        "@aponiajs/auth",
        "redis",
      ],
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
