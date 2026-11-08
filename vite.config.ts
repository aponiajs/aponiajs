import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/cache": new URL("./packages/cache/src/index.ts", import.meta.url).pathname,
      "@aponiajs/compression": new URL("./packages/compression/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/common": new URL("./packages/common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@aponiajs/events": new URL("./packages/events/src/index.ts", import.meta.url).pathname,
      "@aponiajs/http": new URL("./packages/http/src/index.ts", import.meta.url).pathname,
      "@aponiajs/mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
      "@aponiajs/microservices": new URL("./packages/microservices/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/serverless": new URL("./packages/serverless/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/rate-limit": new URL("./packages/rate-limit/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/security": new URL("./packages/security/src/index.ts", import.meta.url).pathname,
      "@aponiajs/session": new URL("./packages/session/src/index.ts", import.meta.url).pathname,
      "@aponiajs/platform-elysia": new URL(
        "./packages/platform-elysia/src/index.ts",
        import.meta.url,
      ).pathname,
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
