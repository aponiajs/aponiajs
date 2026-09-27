import "reflect-metadata";
import type { ClassToken } from "../tokens/token.types.ts";
import type { EnhancerMetadata } from "./enhancer-decorators.types.ts";

// A class decorator receives the constructor and a method decorator receives
// the prototype, so class-level and method-level declarations use one key each,
// and each holder carries the shape it actually needs: one declaration object
// per class, one map keyed by property per prototype.
const classEnhancerMetadataKey = Symbol.for("aponia.enhancer-class.metadata");
const methodEnhancerMetadataKey = Symbol.for("aponia.enhancer-method.metadata");
const catchMetadataKey = Symbol.for("aponia.enhancer-catch.metadata");

type EnhancerKind = keyof EnhancerMetadata;
type EnhancerDeclaration = Partial<EnhancerMetadata>;
type EnhancerDecorator = ClassDecorator & MethodDecorator;

const decoratorNames: Readonly<Record<EnhancerKind, string>> = Object.freeze({
  guards: "@UseGuards",
  interceptors: "@UseInterceptors",
  filters: "@UseFilters",
});

const emptyEnhancerMetadata: EnhancerMetadata = Object.freeze({
  guards: Object.freeze([]),
  interceptors: Object.freeze([]),
  filters: Object.freeze([]),
});

const emptyExceptions: readonly ClassToken<unknown>[] = Object.freeze([]);

/** Declares the guards that run for a controller, or for one of its handlers. */
export function UseGuards(...guards: readonly ClassToken<unknown>[]): EnhancerDecorator {
  return createEnhancerDecorator("guards", guards);
}

/** Declares the interceptors that wrap a controller, or one of its handlers. */
export function UseInterceptors(
  ...interceptors: readonly ClassToken<unknown>[]
): EnhancerDecorator {
  return createEnhancerDecorator("interceptors", interceptors);
}

/** Declares the filters that answer for a controller, or one of its handlers. */
export function UseFilters(...filters: readonly ClassToken<unknown>[]): EnhancerDecorator {
  return createEnhancerDecorator("filters", filters);
}

/**
 * Names the error types a filter answers, applied to the filter class itself
 * exactly as Nest applies it, so the matched types travel with the class that
 * `@UseFilters(SomeFilter)` names. `@Catch()` with no arguments matches
 * anything.
 */
export function Catch(...exceptions: readonly ClassToken<unknown>[]): ClassDecorator {
  assertEnhancerClasses(exceptions, "@Catch");

  return (target) => {
    Reflect.defineMetadata(catchMetadataKey, Object.freeze([...exceptions]), target);
  };
}

/**
 * The types a filter answers, or an empty list when it declared none, which
 * means it catches anything.
 */
export function getCatchMetadata(filter: ClassToken<unknown>): readonly ClassToken<unknown>[] {
  const exceptions = Reflect.getOwnMetadata(catchMetadataKey, filter) as
    | readonly ClassToken<unknown>[]
    | undefined;

  return exceptions ?? emptyExceptions;
}

/**
 * The enhancers declared at one scope: the class's own when `propertyKey` is
 * omitted, the named method's own when it is given. The two scopes are read
 * separately and concatenated by the platform in scope order, so a declaration
 * is reported once however the route that carries it was reached.
 */
export function getEnhancerMetadata(
  target: ClassToken<unknown>,
  propertyKey?: string | symbol,
): EnhancerMetadata {
  if (propertyKey === undefined) {
    return toEnhancerMetadata(readClassDeclaration(target));
  }

  return toEnhancerMetadata(readMethodDeclarations(target.prototype).get(propertyKey));
}

function createEnhancerDecorator(
  kind: EnhancerKind,
  entries: readonly ClassToken<unknown>[],
): EnhancerDecorator {
  if (entries.length === 0) {
    throw new TypeError(`${decoratorNames[kind]} needs at least one enhancer class.`);
  }
  assertEnhancerClasses(entries, decoratorNames[kind]);

  return (target: object, propertyKey?: string | symbol): void => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(
        classEnhancerMetadataKey,
        withEnhancers(readClassDeclaration(target), kind, entries),
        target,
      );
      return;
    }

    const declarations = new Map(readMethodDeclarations(target));
    declarations.set(propertyKey, withEnhancers(declarations.get(propertyKey), kind, entries));
    Reflect.defineMetadata(methodEnhancerMetadataKey, declarations, target);
  };
}

function withEnhancers(
  declaration: EnhancerDeclaration | undefined,
  kind: EnhancerKind,
  entries: readonly ClassToken<unknown>[],
): EnhancerDeclaration {
  switch (kind) {
    case "guards":
      return Object.freeze({
        ...declaration,
        guards: Object.freeze([...(declaration?.guards ?? []), ...entries]),
      });
    case "interceptors":
      return Object.freeze({
        ...declaration,
        interceptors: Object.freeze([...(declaration?.interceptors ?? []), ...entries]),
      });
    case "filters":
      return Object.freeze({
        ...declaration,
        filters: Object.freeze([...(declaration?.filters ?? []), ...entries]),
      });
  }
}

function readClassDeclaration(target: object): EnhancerDeclaration {
  return (
    (Reflect.getOwnMetadata(classEnhancerMetadataKey, target) as EnhancerDeclaration | undefined) ??
    {}
  );
}

function readMethodDeclarations(target: object): ReadonlyMap<string | symbol, EnhancerDeclaration> {
  return (
    (Reflect.getOwnMetadata(methodEnhancerMetadataKey, target) as
      | ReadonlyMap<string | symbol, EnhancerDeclaration>
      | undefined) ?? new Map<string | symbol, EnhancerDeclaration>()
  );
}

function toEnhancerMetadata(declaration: EnhancerDeclaration | undefined): EnhancerMetadata {
  if (declaration === undefined) {
    return emptyEnhancerMetadata;
  }

  return Object.freeze({
    guards: declaration.guards ?? emptyEnhancerMetadata.guards,
    interceptors: declaration.interceptors ?? emptyEnhancerMetadata.interceptors,
    filters: declaration.filters ?? emptyEnhancerMetadata.filters,
  });
}

function assertEnhancerClasses(
  entries: readonly ClassToken<unknown>[],
  decoratorName: string,
): void {
  for (const entry of entries) {
    if (typeof entry !== "function") {
      throw new TypeError(`${decoratorName} accepts enhancer classes only.`);
    }
  }
}
