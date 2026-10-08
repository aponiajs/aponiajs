// Bun preload register hook
import { type BunPlugin, plugin } from "bun";
import { COMPILED_DESCRIPTOR_SYMBOL } from "./in-memory-compiler.ts";

export const aponiaCompilerPlugin: BunPlugin = {
  name: "aponia-in-memory-compiler",
  setup(build): void {
    if (typeof build?.onLoad === "function") {
      build.onLoad({ filter: /\.(module|controller)\.ts$/ }, async (args) => {
        const contents = await Bun.file(args.path).text();
        return {
          contents,
          loader: "ts",
        };
      });
    }
  },
};

// Register Bun plugin for automatic zero-config compilation
void plugin(aponiaCompilerPlugin);

export { COMPILED_DESCRIPTOR_SYMBOL };
