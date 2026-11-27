import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/auth": new URL("./packages/auth/src/index.ts", import.meta.url).pathname,
      "@aponiajs/cache": new URL("./packages/cache/src/index.ts", import.meta.url).pathname,
      "@aponiajs/compression": new URL("./packages/compression/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/config": new URL("./packages/config/src/index.ts", import.meta.url).pathname,
      "@aponiajs/cors": new URL("./packages/cors/src/index.ts", import.meta.url).pathname,
      "@aponiajs/cqrs": new URL("./packages/cqrs/src/index.ts", import.meta.url).pathname,
      "@aponiajs/cron": new URL("./packages/cron/src/index.ts", import.meta.url).pathname,
      "@aponiajs/database": new URL("./packages/database/src/index.ts", import.meta.url).pathname,
      "@aponiajs/devtools": new URL("./packages/devtools/src/index.ts", import.meta.url).pathname,
      "@aponiajs/graphql": new URL("./packages/graphql/src/index.ts", import.meta.url).pathname,
      "@aponiajs/openapi": new URL("./packages/openapi/src/index.ts", import.meta.url).pathname,
      "@aponiajs/queue": new URL("./packages/queue/src/index.ts", import.meta.url).pathname,
      "@aponiajs/testing": new URL("./packages/testing/src/index.ts", import.meta.url).pathname,
      "@aponiajs/view": new URL("./packages/view/src/index.ts", import.meta.url).pathname,
      "@aponiajs/common": new URL("./packages/common/src/index.ts", import.meta.url).pathname,
      "@aponiajs/compiler": new URL("./packages/compiler/src/index.ts", import.meta.url).pathname,
      "@aponiajs/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@aponiajs/events": new URL("./packages/events/src/index.ts", import.meta.url).pathname,
      "@aponiajs/http": new URL("./packages/http/src/index.ts", import.meta.url).pathname,
      "@aponiajs/mapped-types": new URL("./packages/mapped-types/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
      "@aponiajs/microservices": new URL("./packages/microservices/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/nitro": new URL("./packages/nitro/src/index.ts", import.meta.url).pathname,
      "@aponiajs/serverless": new URL("./packages/serverless/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/rate-limit": new URL("./packages/rate-limit/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/security": new URL("./packages/security/src/index.ts", import.meta.url).pathname,
      "@aponiajs/serve-static": new URL("./packages/serve-static/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/session": new URL("./packages/session/src/index.ts", import.meta.url).pathname,
      "@aponiajs/terminus": new URL("./packages/terminus/src/index.ts", import.meta.url).pathname,
      "@aponiajs/platform-h3": new URL("./packages/platform-h3/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/platform-hono": new URL("./packages/platform-hono/src/index.ts", import.meta.url)
        .pathname,
      "@aponiajs/platform-elysia": new URL(
        "./packages/platform-elysia/src/index.ts",
        import.meta.url,
      ).pathname,
    },
    globals: true,
    include: ["packages/*/test/**/*.conformance.ts"],
  },
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
