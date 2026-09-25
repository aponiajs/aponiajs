import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The formatter entry the generated modules are laid out by, and the only one
 * this package reads.
 *
 * `vite-plus` is the toolchain behind `bun run check` and `vp check`, and the
 * subpath is its published formatter entry, which re-exports `oxfmt`'s own
 * `format` unchanged.
 */
const formatterSpecifier = "vite-plus/fmt";

/**
 * The package the specifier above belongs to, checked for where it is installed
 * rather than resolved, because resolving it always succeeds.
 */
const toolchainPackage = "vite-plus";

/** What this package needs from the resolved formatter. */
type GeneratedSourceFormatter = (
  fileName: string,
  sourceText: string,
) => Promise<{ readonly code: string; readonly errors: readonly unknown[] }>;

/**
 * Formats one generated module the way the project's own check would.
 *
 * The generated modules are committed into an application and read by its
 * `vp check`, so they have to be byte-identical to what that check's formatter
 * would produce. Reimplementing that layout here is what the reuse rule forbids,
 * and the emitters used to attempt it: they hand-wrapped their own output, and
 * it stopped matching the formatter as soon as either side changed. The
 * formatter is called instead.
 *
 * Losing the lookup is not a failure. The emitters' own output is valid
 * TypeScript, so a checkout with no toolchain installed still generates both
 * modules; they are simply laid out the way the emitters wrote them.
 */
export async function formatGeneratedSource(
  projectRoot: string,
  fileName: string,
  source: string,
): Promise<string> {
  const formatter = await resolveFormatter(projectRoot);
  if (formatter === undefined) {
    return source;
  }

  const formatted = await formatter(fileName, source);
  const [error] = formatted.errors;
  if (error !== undefined) {
    // The emitter produced something the formatter cannot parse. That is a
    // fault in this package rather than in the project being built, so it is
    // reported instead of being written out unformatted.
    throw new Error(`The generated ${fileName} is not valid TypeScript: ${describe(error)}`);
  }

  return formatted.code;
}

/**
 * What a formatter reported, as text.
 *
 * The formatter reports a diagnostic object per error, so `String` would answer
 * `[object Object]` — the least useful end of the message for the one reader
 * this exists for, who has to find the declaration behind it.
 */
function describe(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : String(error);
}

/**
 * The formatter to lay generated source out with, or `undefined` when none is
 * installed.
 *
 * The project is asked first, because that is the copy whose `vp check` will
 * read the file: `vite-plus` pins the exact `oxfmt` it formats with, so the copy
 * the project already has is what keeps a build from writing a file that fails
 * the check following it. The directory this module lives in is the fallback,
 * which is what covers a project that has not been installed yet — including
 * this repository's own tests, which render a template into a temporary
 * directory — and an application the CLI was installed into.
 */
async function resolveFormatter(
  projectRoot: string,
): Promise<GeneratedSourceFormatter | undefined> {
  if (await hasOwnToolchain(projectRoot)) {
    const formatter = await importFormatter(projectRoot);
    if (formatter !== undefined) {
      return formatter;
    }
  }

  return importFormatter(import.meta.dir);
}

/**
 * Whether the project installed the toolchain itself.
 *
 * `Bun.resolveSync` falls back to Bun's global install cache, so asking it about
 * a project that has not been installed answers with whatever the machine
 * happens to have — an unrelated release as easily as the intended one — and
 * formatting with that is how a build writes a file the project's own check
 * rejects. Looking for the package first keeps the answer local: when it is
 * there, resolution finds it before the cache is ever consulted.
 */
async function hasOwnToolchain(projectRoot: string): Promise<boolean> {
  return Bun.file(join(projectRoot, "node_modules", toolchainPackage, "package.json")).exists();
}

async function importFormatter(directory: string): Promise<GeneratedSourceFormatter | undefined> {
  try {
    const module = (await import(
      pathToFileURL(Bun.resolveSync(formatterSpecifier, directory)).href
    )) as { readonly format?: unknown };

    return typeof module.format === "function"
      ? (module.format as GeneratedSourceFormatter)
      : undefined;
  } catch {
    // A directory that cannot resolve the toolchain is the documented case, not
    // a fault: the emitters' own output is valid without it.
    return undefined;
  }
}
