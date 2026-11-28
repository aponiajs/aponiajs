import {
  isForwardRef,
  type ModuleClass,
  type ModuleDefinition,
  type ModuleImportDescriptor,
} from "@aponiajs/common";

/**
 * Replaces every occurrence of one module in a compiled graph.
 *
 * Nest's `overrideModule` matches by reference, so the identity compared here is
 * the module class the graph lowered, never a name. A module reached along two
 * import paths is replaced on both. A `forwardRef` is left untouched because the
 * compiler resolves it lazily, and eagerly following one would defeat the
 * cycle it exists to break.
 *
 * @param root - The compiled root to rewrite.
 * @param target - The module class to replace.
 * @param replacement - The compiled definition that stands in for it.
 * @returns The rewritten root, or the original when nothing matched.
 *
 * @internal
 */
export function replaceCompiledModule(
  root: ModuleDefinition,
  target: ModuleClass,
  replacement: ModuleDefinition,
): ModuleDefinition {
  if (root.moduleClass === target) {
    return replacement;
  }

  let changed = false;
  const imports = root.imports.map((entry) => {
    if (isForwardRef(entry)) {
      return entry;
    }
    const replaced = replaceCompiledModule(entry, target, replacement);
    if (replaced !== entry) {
      changed = true;
    }
    return replaced;
  });

  return changed ? Object.freeze({ ...root, imports: Object.freeze(imports) }) : root;
}

/**
 * The import descriptors a rewritten graph holds.
 *
 * @internal
 */
export type { ModuleImportDescriptor };
