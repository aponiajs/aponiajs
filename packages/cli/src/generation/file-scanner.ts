import { join } from "node:path";

/**
 * The file scan `fast-glob` used to own, over the runtime's own glob.
 *
 * `fast-glob` reached this package only through `micromatch` and `braces`, and
 * the innermost of the two carries a high-severity advisory with no published
 * fix — so the scan stays but the dependency goes. `Bun.Glob` answers the
 * include half; the ignore half is a matcher over the same patterns
 * `fast-glob` read, because the runtime's scan takes no `ignore` option.
 *
 * @param pattern - The include glob, relative to `directory`.
 * @param directory - The directory the pattern is read from.
 * @param ignore - Glob patterns a matched file must not satisfy.
 * @returns The matched files as absolute paths.
 */
export async function scanSourceFiles(
  pattern: string,
  directory: string,
  ignore: readonly string[] = [],
): Promise<string[]> {
  const ignoreMatchers = ignore.map((entry) => new Bun.Glob(entry));
  const excluded = (file: string): boolean => ignoreMatchers.some((matcher) => matcher.match(file));

  const files: string[] = [];
  for await (const relative of new Bun.Glob(pattern).scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    if (!excluded(relative)) {
      files.push(join(directory, relative));
    }
  }

  return files;
}
