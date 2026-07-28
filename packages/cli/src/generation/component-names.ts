import { camelCase, kebabCase, pascalCase } from "change-case";
import { singularize } from "inflection";
import { isAbsolute } from "node:path";
import type { ComponentNames } from "./component-names.types.ts";

export function createComponentNames(input: string): ComponentNames {
  const segments = normalizeNameSegments(input);
  const fileName = segments.at(-1)!;
  const singularFileName = singularize(fileName);
  return {
    fileName,
    className: pascalCase(fileName),
    propertyName: camelCase(fileName),
    singularFileName,
    singularClassName: pascalCase(singularFileName),
    routePath: fileName,
  };
}

export function normalizeNameSegments(input: string): string[] {
  if (isAbsolute(input) || input.includes("..")) {
    throw new Error("Generated names must be relative and cannot contain parent traversal.");
  }

  const segments = input
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => kebabCase(segment, { locale: false }));
  if (segments.length === 0 || segments.some((segment) => !/^[a-z][a-z0-9-]*$/.test(segment))) {
    throw new Error("Generated names must contain letters and use kebab-case paths.");
  }
  return segments;
}
