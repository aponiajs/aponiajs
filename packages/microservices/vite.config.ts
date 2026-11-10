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
      neverBundle: [
        "@aponiajs/common",
        "@aponiajs/platform-elysia",
        "@aws-sdk/client-sqs",
        "@azure/service-bus",
        "@google-cloud/pubsub",
        "elysia",
        "kafkajs",
        "mqtt",
        "nats",
        "rabbitmq-client",
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
