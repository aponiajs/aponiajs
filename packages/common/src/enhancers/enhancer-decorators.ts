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

/**
 * Declares the guards that run for a controller, or for one of its handlers.
 *
 * Entries are classes the module graph resolves as providers; a guard answers
 * `false` to refuse with `403`, and throws its own `HttpError` for any other
 * status.
 *
 * @param guards - The guard classes, in the order they run.
 * @returns A decorator recording the frozen guard list at class or method scope.
 *
 * @example
 * ```ts
 * @UseGuards(AuthGuard)
 * @Controller("users")
 * class UsersController {}
 * ```
 */
export function UseGuards(...guards: readonly ClassToken<unknown>[]): EnhancerDecorator {
  return createEnhancerDecorator("guards", guards);
}

/**
 * Declares the interceptors that wrap a controller, or one of its handlers.
 *
 * `interceptBefore` halves run in declaration order; `interceptAfter` halves
 * run over the same list reversed.
 *
 * @param interceptors - The interceptor classes, in the order they run.
 * @returns A decorator recording the frozen interceptor list at class or method scope.
 *
 * @example
 * ```ts
 * @UseInterceptors(LoggingInterceptor)
 * @Controller("users")
 * class UsersController {}
 * ```
 */
export function UseInterceptors(
  ...interceptors: readonly ClassToken<unknown>[]
): EnhancerDecorator {
  return createEnhancerDecorator("interceptors", interceptors);
}

/**
 * Declares the filters that answer for a controller, or one of its handlers.
 *
 * Filters run most-specific-first: the handler's own before the controller's,
 * then the application's, then the default Problem Details mapping.
 *
 * @param filters - The filter classes, in the order they are consulted.
 * @returns A decorator recording the frozen filter list at class or method scope.
 *
 * @example
 * ```ts
 * @UseFilters(DomainFilter)
 * @Controller("users")
 * class UsersController {}
 * ```
 */
export function UseFilters(...filters: readonly ClassToken<unknown>[]): EnhancerDecorator {
  return createEnhancerDecorator("filters", filters);
}

/**
 * Names the error types a filter answers, applied to the filter class itself
 * exactly as Nest applies it, so the matched types travel with the class that
 * `@UseFilters(SomeFilter)` names. `@Catch()` with no arguments matches
 * anything.
 *
 * @param exceptions - The error classes the filter answers, matched with
 * `instanceof` in declaration order.
 * @returns A class decorator recording the frozen exception list.
 *
 * @example
 * ```ts
 * @Catch(HttpError)
 * @Injectable()
 * class DomainFilter implements ExceptionFilter {
 *   catch(exception: unknown, host: ArgumentsHost): unknown {
 *     return undefined;
 *   }
 * }
 * ```
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
 *
 * @param filter - The filter class to read.
 * @returns The frozen exception list, or an empty list for a catch-all.
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
 *
 * @param target - The controller class to read.
 * @param propertyKey - The handler method to read, or the class scope when omitted.
 * @returns The frozen enhancer metadata of that scope.
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
