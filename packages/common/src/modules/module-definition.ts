import { isForwardRef } from "./forward-ref.ts";
import { type ModuleDefinition } from "../interfaces/module.interface.ts";

/**
 * Whether a module import is already the descriptor the container compiles,
 * rather than a class or a dynamic module the boot lowers.
 *
 * Exported because a boot's own record has to name the graph it served, and the
 * answer is this one question: a descriptor is data, while a class and a dynamic
 * module both have their decorators read and lowered.
 *
 * @internal
 */
export function isModuleDefinition(moduleImport: unknown): moduleImport is ModuleDefinition {
  return (
    typeof moduleImport === "object" &&
    moduleImport !== null &&
    !isForwardRef(moduleImport) &&
    "controllers" in moduleImport &&
    !("module" in moduleImport)
  );
}
