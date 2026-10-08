// Bun preload register hook
import { plugin } from "bun";
import { COMPILED_DESCRIPTOR_SYMBOL } from "./in-memory-compiler.ts";

export interface AponiaBunPlugin {
  readonly name: string;
  setup(build: {
    onLoad?(
      options: { filter: RegExp },
      callback: (args: {
        path: string;
      }) => Promise<{ contents: string; loader: string }> | { contents: string; loader: string },
    ): void;
  }): void;
}

export const aponiaCompilerPlugin: AponiaBunPlugin = {
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
void plugin(aponiaCompilerPlugin as any);

export { COMPILED_DESCRIPTOR_SYMBOL };
