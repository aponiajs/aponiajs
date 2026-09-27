import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // The build reads a tsconfig without the workspace `paths` the test lane
    // needs. With them, the declaration emitter follows those mappings into the
    // other packages' sources and writes a `.d.ts` beside every file it finds.
    tsconfig: "tsconfig.build.json",
    dts: {
      tsgo: true,
      tsconfig: "tsconfig.build.json",
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
