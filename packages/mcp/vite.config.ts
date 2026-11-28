import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    alias: {
      "@aponiajs/common": new URL("../common/src/index.ts", import.meta.url).pathname,
    },
    globals: true,
    include: ["test/**/*.conformance.ts"],
  },
  pack: {
    // The build reads a tsconfig without the workspace `paths` the test lane
    // needs. With them, the declaration emitter follows those mappings into the
    // other packages' sources and writes a `.d.ts` beside every file it finds.
    tsconfig: "tsconfig.build.json",
    dts: true,
    exports: true,
    deps: {
      neverBundle: [
        "@aponiajs/common",
        "@modelcontextprotocol/server",
        "elysia",
        "h3",
        "hono",
        "zod",
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
