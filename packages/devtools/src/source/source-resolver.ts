import { resolve } from "node:path";
import type { SourceCodeResult, SourceResolverOptions } from "./source-resolver.types.ts";

/**
 * Resolves the source code of a specified target (e.g. class or method).
 *
 * @param target - The component class name or "Class.method" identifier.
 * @param options - Options specifying source files or project directory.
 * @returns The resolved source code and location, or undefined if not found.
 */
export async function resolveSourceCode(
  target: string,
  options: SourceResolverOptions = {},
): Promise<SourceCodeResult | undefined> {
  const sourceFiles = options.sourceFiles ?? (await discoverSourceFiles(options.cwd));

  const [className, methodName] = target.split(".") as [string, string | undefined];

  for (const file of sourceFiles) {
    try {
      const content = await Bun.file(file).text();

      // Check if file contains the class
      const classRegex = new RegExp(`(?:export\\s+)?class\\s+${className}\\b`, "m");
      const classMatch = classRegex.exec(content);
      if (!classMatch) {
        continue;
      }

      const lines = content.split("\n");
      const classCharIndex = classMatch.index;
      const classLineIndex = content.slice(0, classCharIndex).split("\n").length - 1;

      // Include decorators immediately preceding the class
      let startLineIndex = classLineIndex;
      while (startLineIndex > 0 && lines[startLineIndex - 1]?.trim().startsWith("@")) {
        startLineIndex--;
      }

      // Find the end of class by tracking braces
      const classStartIndex = content.indexOf("{", classCharIndex);
      if (classStartIndex === -1) {
        continue;
      }

      const classEndIndex = findMatchingBrace(content, classStartIndex);
      const classEndLineIndex = content.slice(0, classEndIndex + 1).split("\n").length - 1;

      // If a specific method was requested
      if (methodName !== undefined) {
        const classBody = content.slice(classStartIndex, classEndIndex);
        const methodRegex = new RegExp(
          `(?:(?:async|public|private|protected|readonly)\\s+)*${methodName}\\s*\\(`,
          "m",
        );
        const methodMatch = methodRegex.exec(classBody);

        if (methodMatch) {
          const methodCharIndex = classStartIndex + methodMatch.index;
          const methodLineIndex = content.slice(0, methodCharIndex).split("\n").length - 1;

          // Include decorators immediately preceding the method
          let methodStartLineIndex = methodLineIndex;
          while (
            methodStartLineIndex > classLineIndex &&
            lines[methodStartLineIndex - 1]?.trim().startsWith("@")
          ) {
            methodStartLineIndex--;
          }

          const methodBraceIndex = content.indexOf("{", methodCharIndex);
          if (methodBraceIndex !== -1 && methodBraceIndex < classEndIndex) {
            const methodEndCharIndex = findMatchingBrace(content, methodBraceIndex);
            const methodEndLineIndex =
              content.slice(0, methodEndCharIndex + 1).split("\n").length - 1;

            const methodCode = lines.slice(methodStartLineIndex, methodEndLineIndex + 1).join("\n");
            return Object.freeze({
              target,
              filePath: file,
              lineStart: methodStartLineIndex + 1,
              lineEnd: methodEndLineIndex + 1,
              code: methodCode,
            });
          }
        }
        continue;
      }

      // Entire class requested
      const classCode = lines.slice(startLineIndex, classEndLineIndex + 1).join("\n");
      return Object.freeze({
        target,
        filePath: file,
        lineStart: startLineIndex + 1,
        lineEnd: classEndLineIndex + 1,
        code: classCode,
      });
    } catch {
      // Continue searching next file
    }
  }

  return undefined;
}

/**
 * Finds the index of the matching closing brace.
 */
function findMatchingBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i++) {
    const char = text[i];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return text.length - 1;
}

/**
 * Discovers TypeScript source files in the project's src directory.
 */
async function discoverSourceFiles(cwd = process.cwd()): Promise<string[]> {
  const glob = new Bun.Glob("src/**/*.ts");
  const files: string[] = [];
  try {
    for await (const file of glob.scan({ cwd, onlyFiles: true })) {
      if (!file.endsWith(".spec.ts") && !file.endsWith(".test.ts")) {
        files.push(resolve(cwd, file));
      }
    }
  } catch {
    // Return empty on failure
  }
  return files;
}
