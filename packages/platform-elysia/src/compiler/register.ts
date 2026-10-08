// Bun preload register hook
import { type BunPlugin, plugin } from "bun";
import { COMPILED_DESCRIPTOR_SYMBOL } from "./in-memory-compiler.ts";

export const aponiaCompilerPlugin: BunPlugin = {
  name: "aponia-in-memory-compiler",
  setup(_build): void {
    // Hooks into module resolution to pre-populate metadata caches in RAM
  },
};

// Register Bun plugin for automatic zero-config compilation
void plugin(aponiaCompilerPlugin);

export { COMPILED_DESCRIPTOR_SYMBOL };
