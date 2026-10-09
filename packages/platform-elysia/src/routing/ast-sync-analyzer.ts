/**
 * AST Synchronous Analyzer for route handlers.
 * Detects whether a method function is genuinely synchronous without async/await.
 *
 * @internal
 */
export function isMethodSynchronous(methodFn: Function): boolean {
  // Check if native async function constructor
  if (
    typeof methodFn !== "function" ||
    methodFn.constructor.name === "AsyncFunction" ||
    methodFn.constructor.name === "AsyncGeneratorFunction"
  ) {
    return false;
  }
  const source = methodFn.toString();
  // Check for async keyword or await token in source
  if (/^\s*async\b/.test(source) || /\bawait\b/.test(source)) {
    return false;
  }
  return true;
}
