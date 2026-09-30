import {
  Node,
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type Decorator,
  type Expression,
  type MethodDeclaration,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import { readExpressionImports, readSourceImports } from "./source-imports.ts";
import type { SourceImports } from "./source-imports.types.ts";
import type {
  AnalyzedController,
  AnalyzedEnhancerKind,
  AnalyzedEnhancers,
  AnalyzedRequestMethod,
  AnalyzedRoute,
  AnalyzedRouteParameter,
  AnalyzedRouteParameterKind,
  AnalyzedRouteSchema,
  AnalyzedRouteSchemaSlot,
  AnalyzedRouteSchemaSlotName,
} from "./controller-routes.types.ts";

const aponiaModuleSpecifier = "@aponiajs/common";
const controllerDecoratorName = "Controller";

/**
 * The schema slots a route decorator reads, in the order the analysis reports
 * them. The order is the framework's own (`routeSchemaSlots` in
 * `packages/common/src/routing/route-schema.ts`), not the order the decorator
 * wrote them in, so a reordered options object reads the same.
 */
const routeSchemaSlotNames: readonly AnalyzedRouteSchemaSlotName[] = [
  "body",
  "query",
  "params",
  "headers",
  "cookie",
  "response",
];

/**
 * The HTTP method decorators of `@aponiajs/common`, keyed by the name the
 * package exports (`packages/common/src/decorators/decorators.ts`).
 */
const requestMethodDecorators: ReadonlyMap<string, AnalyzedRequestMethod> = new Map([
  ["Delete", "DELETE"],
  ["Get", "GET"],
  ["Head", "HEAD"],
  ["Options", "OPTIONS"],
  ["Patch", "PATCH"],
  ["Post", "POST"],
  ["Put", "PUT"],
]);

/**
 * The parameter decorators of `@aponiajs/common`, keyed by the name the package
 * exports (`packages/common/src/routing/route-parameters.ts`).
 */
const parameterDecorators: ReadonlyMap<string, AnalyzedRouteParameterKind> = new Map([
  ["Body", "body"],
  ["Cookie", "cookie"],
  ["Context", "context"],
  ["Headers", "headers"],
  ["HttpStatus", "status"],
  ["Param", "params"],
  ["Query", "query"],
  ["Req", "request"],
  ["ResponseSettings", "set"],
  ["State", "store"],
]);

/**
 * The enhancer decorators of `@aponiajs/common`, keyed by the name the package
 * exports (`packages/common/src/enhancers/enhancer-decorators.ts`).
 */
const enhancerDecorators: ReadonlyMap<string, AnalyzedEnhancerKind> = new Map([
  ["UseFilters", "filters"],
  ["UseGuards", "guards"],
  ["UseInterceptors", "interceptors"],
]);

const noControllers: readonly AnalyzedController[] = Object.freeze([]);
const noRoutes: readonly AnalyzedRoute[] = Object.freeze([]);
const noEnhancers: AnalyzedEnhancers = Object.freeze({
  guards: Object.freeze([]),
  interceptors: Object.freeze([]),
  filters: Object.freeze([]),
  unreadable: undefined,
});

/**
 * What a source file imports from `@aponiajs/common`.
 *
 * A decorator is Aponia's only when the file binds the decorator's name to that
 * exact module specifier, either through a named import or through a namespace
 * import. Matching by name alone would treat a same-named decorator from another
 * package as Aponia's, and would accept a file that never imports the framework
 * at all. A file that imports nothing from `@aponiajs/common` therefore yields
 * no controllers.
 */
interface AponiaDecoratorBindings {
  /** Local name to exported name, so an aliased import still resolves. */
  readonly imports: ReadonlyMap<string, string>;
  readonly namespaces: ReadonlySet<string>;
}

/** A recognized decorator invocation and the arguments it was called with. */
interface AponiaDecoratorUse {
  readonly name: string;
  readonly arguments: readonly Node[];
}

/**
 * Reads one controller source file into the route plan that build-time code
 * generation lowers into a route invoker.
 *
 * Analysis is static and exact: it parses `source` with `ts-morph` and never
 * evaluates it, so it is unaffected by minification or bundling. Decorators are
 * matched against the `@aponiajs/common` import of the same file, results follow
 * declaration order, and every returned object is frozen.
 *
 * A decorator's path must be a plain string literal, and a decorator that omits
 * its path must pass its schema as an inline object literal. Any other argument
 * shape cannot be read statically and throws a plain `Error`, because the
 * generated invoker would otherwise bind the wrong arguments. The trailing
 * schema of the `(path, schema)` arity is read as the source expression to emit
 * again — a validation model by class name, an inline validator by its own text,
 * a status-keyed response map by the literal that declares it — together with the
 * names that expression reads, which a generated module has to import. A slot
 * whose value the analysis cannot reproduce is reported in `unreadable` rather
 * than dropped. A bare `@Get` or `@Controller` that is never called is ignored,
 * because the framework's decorator factories must be invoked to record
 * anything.
 *
 * @param source - The full text of one controller source file.
 * @param filePath - The file's path, used only to describe failures.
 */
export function analyzeControllerRoutes(
  source: string,
  filePath: string,
): readonly AnalyzedController[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, source);
  const bindings = collectAponiaDecoratorBindings(sourceFile);
  if (bindings.imports.size === 0 && bindings.namespaces.size === 0) {
    return noControllers;
  }

  assertParameterDecoratorsDecorateMethods(sourceFile, bindings, filePath);

  const imports = readSourceImports(sourceFile);
  const controllers = sourceFile
    .getClasses()
    .flatMap((declaration) => analyzeController(declaration, bindings, imports, filePath));
  return Object.freeze(controllers);
}

/**
 * Reads the decorator names a file imports from `@aponiajs/common`. Named
 * imports are recorded under their local alias, so
 * `import { Get as Read } from "@aponiajs/common"` recognizes `@Read()`.
 */
function collectAponiaDecoratorBindings(sourceFile: SourceFile): AponiaDecoratorBindings {
  const imports = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== aponiaModuleSpecifier) {
      continue;
    }

    for (const namedImport of declaration.getNamedImports()) {
      imports.set(
        namedImport.getAliasNode()?.getText() ?? namedImport.getName(),
        namedImport.getName(),
      );
    }

    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) {
      namespaces.add(namespaceImport.getText());
    }
  }

  return { imports, namespaces };
}

/**
 * Reads one class into the route plan when Aponia's `@Controller` decorates it,
 * and ignores every other class in the file.
 */
function analyzeController(
  declaration: ClassDeclaration,
  bindings: AponiaDecoratorBindings,
  imports: SourceImports,
  filePath: string,
): readonly AnalyzedController[] {
  const controllerUse = declaration
    .getDecorators()
    .map((decorator) => readDecoratorUse(decorator, bindings))
    .find((use) => use?.name === controllerDecoratorName);
  if (!controllerUse) {
    return noControllers;
  }

  const description = describeDecoratorUse(controllerUse, filePath);
  if (controllerUse.arguments.length > 1) {
    throw new Error(`${description} must declare at most one path argument.`);
  }

  const pathArgument = controllerUse.arguments[0];
  const path = pathArgument === undefined ? "" : readStringLiteral(pathArgument, description);
  const controllerEnhancers = readEnhancers(declaration.getDecorators(), bindings, filePath);
  const routes = declaration
    .getMethods()
    .flatMap((method) =>
      analyzeRouteMethod(method, bindings, imports, filePath, controllerEnhancers),
    );

  return [
    Object.freeze({
      className: declaration.getName() ?? "",
      path,
      routes: Object.freeze(routes),
    }),
  ];
}

/**
 * Reads every route a method declares. A method may carry more than one HTTP
 * method decorator, and the framework records one route per decorator, so each
 * recognized decorator becomes its own route.
 */
function analyzeRouteMethod(
  method: MethodDeclaration,
  bindings: AponiaDecoratorBindings,
  imports: SourceImports,
  filePath: string,
  controllerEnhancers: AnalyzedEnhancers,
): readonly AnalyzedRoute[] {
  const routes = method.getDecorators().flatMap((decorator) => {
    const use = readDecoratorUse(decorator, bindings);
    const requestMethod = use && requestMethodDecorators.get(use.name);
    return use && requestMethod !== undefined ? [{ use, method: requestMethod }] : [];
  });
  if (routes.length === 0) {
    return noRoutes;
  }

  const parameters = readRouteParameters(method, bindings, filePath);
  const methodName = method.getName();
  const promiseCapable = returnsPromise(method);
  const declaresSynchronousReturn = readsSynchronousReturn(method);
  const declaresParameters = method.getParameters().length > 0;
  const usesArgumentsObject = readsArgumentsObject(method);
  const enhancers = mergeEnhancers(
    controllerEnhancers,
    readEnhancers(method.getDecorators(), bindings, filePath),
  );

  return Object.freeze(
    routes.map(({ use, method: requestMethod }) =>
      Object.freeze({
        method: requestMethod,
        path: readRoutePath(use, filePath),
        methodName,
        promiseCapable,
        declaresSynchronousReturn,
        declaresParameters,
        usesArgumentsObject,
        parameters,
        schema: readRouteSchema(use, imports, filePath),
        enhancers,
      }),
    ),
  );
}

/**
 * Reads the enhancer classes one scope declares: a controller class's own when
 * the decorators are the class's, or one handler's own when they are the
 * method's.
 *
 * The runtime records a stacked declaration bottom-up, because decorators are
 * applied in the reverse of the order they were written, and each application
 * appends its entries to what is already there. Reading the decorators in that
 * same order is what keeps a class declared twice in one list in the order it
 * runs.
 *
 * Only a plain class reference can be read: any other argument is a value the
 * runtime computed, and a generated module has no second copy of it. Such an
 * argument is reported rather than skipped, because a route emitted without it
 * would be less guarded than the one the application wrote.
 */
function readEnhancers(
  decorators: readonly Decorator[],
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedEnhancers {
  const guards: string[] = [];
  const interceptors: string[] = [];
  const filters: string[] = [];
  let unreadable: string | undefined;

  for (const decorator of [...decorators].reverse()) {
    const use = readDecoratorUse(decorator, bindings);
    const kind = use === undefined ? undefined : enhancerDecorators.get(use.name);
    if (use === undefined || kind === undefined) {
      continue;
    }

    const description = describeDecoratorUse(use, filePath);
    for (const argument of use.arguments) {
      if (!Node.isIdentifier(argument)) {
        unreadable ??= `${description} must name each enhancer with a class reference to be read statically.`;
        continue;
      }

      const name = argument.getText();
      switch (kind) {
        case "guards":
          guards.push(name);
          break;
        case "interceptors":
          interceptors.push(name);
          break;
        case "filters":
          filters.push(name);
          break;
      }
    }
  }

  if (
    guards.length === 0 &&
    interceptors.length === 0 &&
    filters.length === 0 &&
    unreadable === undefined
  ) {
    return noEnhancers;
  }

  return Object.freeze({
    guards: Object.freeze(guards),
    interceptors: Object.freeze(interceptors),
    filters: Object.freeze(filters),
    unreadable,
  });
}

/**
 * Joins the two scopes a route's enhancers are declared at, in the order the
 * runtime runs them.
 *
 * This mirrors `mergeEnhancerMetadata` in
 * `packages/platform-elysia/src/routing/route-compiler.ts` by hand: guards and
 * interceptors run outward-in, so the class's own declarations come first,
 * while filters run most-specific-first, so the handler's come first. A
 * generated route states the joined list, because a declared plan carries one
 * list where a decorated controller has a class to ask per scope.
 */
function mergeEnhancers(
  controller: AnalyzedEnhancers,
  handler: AnalyzedEnhancers,
): AnalyzedEnhancers {
  return Object.freeze({
    guards: Object.freeze([...controller.guards, ...handler.guards]),
    interceptors: Object.freeze([...controller.interceptors, ...handler.interceptors]),
    filters: Object.freeze([...handler.filters, ...controller.filters]),
    unreadable: controller.unreadable ?? handler.unreadable,
  });
}

/**
 * An identifier named `arguments` that is the value being read, rather than a
 * property called `arguments` or an object key spelled that way.
 */
function readsArgumentsObject(method: MethodDeclaration): boolean {
  return method.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => {
    if (identifier.getText() !== "arguments") {
      return false;
    }

    const parent = identifier.getParent();
    if (Node.isPropertyAccessExpression(parent)) {
      // `arguments.length` reads the object, `value.arguments` names a property.
      return parent.getExpression() === identifier;
    }

    return (
      !Node.isPropertyAssignment(parent) &&
      !Node.isPropertySignature(parent) &&
      !Node.isMethodDeclaration(parent)
    );
  });
}

/**
 * Reads the path an HTTP method decorator declares. The documented arities are
 * `()`, `(path)`, `(schema)`, and `(path, schema)`; a schema-only decorator
 * declares no path. The schema itself is not part of the route plan, because the
 * runtime hands it to the platform unchanged.
 */
function readRoutePath(use: AponiaDecoratorUse, filePath: string): string {
  const description = describeDecoratorUse(use, filePath);
  if (use.arguments.length > 2) {
    throw new Error(`${description} must declare at most a path and a schema.`);
  }

  const pathArgument = use.arguments[0];
  if (pathArgument === undefined) {
    return "";
  }
  if (use.arguments.length === 1 && Node.isObjectLiteralExpression(pathArgument)) {
    return "";
  }
  return readStringLiteral(pathArgument, description);
}

/**
 * Reads the parameters a method's parameter decorators bind, ordered by
 * parameter index, which is the order the runtime resolves them in.
 */
function readRouteParameters(
  method: MethodDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): readonly AnalyzedRouteParameter[] {
  const parameters: AnalyzedRouteParameter[] = [];

  for (const [index, parameter] of method.getParameters().entries()) {
    for (const decorator of parameter.getDecorators()) {
      const use = readDecoratorUse(decorator, bindings);
      const kind = use && parameterDecorators.get(use.name);
      if (!use || kind === undefined) {
        continue;
      }

      parameters.push(Object.freeze({ index, kind, property: readBindingProperty(use, filePath) }));
    }
  }

  return Object.freeze(parameters.toSorted((left, right) => left.index - right.index));
}

/** The documented arity of every parameter decorator is `(property?: string)`. */
function readBindingProperty(use: AponiaDecoratorUse, filePath: string): string | undefined {
  const description = describeDecoratorUse(use, filePath);
  if (use.arguments.length > 1) {
    throw new Error(`${description} must declare at most one property name.`);
  }

  const propertyArgument = use.arguments[0];
  return propertyArgument === undefined
    ? undefined
    : readStringLiteral(propertyArgument, description);
}

/**
 * A parameter decorator on anything but a method parameter is invalid Aponia
 * usage, and the runtime decorator throws for it. Rejecting it here keeps the
 * generated invoker from silently dropping a binding.
 */
function assertParameterDecoratorsDecorateMethods(
  sourceFile: SourceFile,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): void {
  for (const decorator of sourceFile.getDescendantsOfKind(SyntaxKind.Decorator)) {
    const use = readDecoratorUse(decorator, bindings);
    if (!use || !parameterDecorators.has(use.name)) {
      continue;
    }

    const owner = decorator.getParent();
    if (Node.isParameterDeclaration(owner) && Node.isMethodDeclaration(owner.getParent())) {
      continue;
    }

    throw new Error(
      `${describeDecoratorUse(use, filePath)} can only decorate a route handler parameter.`,
    );
  }
}

/**
 * A handler is Promise-capable when it is declared `async` or annotated with
 * `Promise<...>`. The method body is deliberately not consulted, because a
 * returned Promise is not visible in the source.
 */
function returnsPromise(method: MethodDeclaration): boolean {
  if (method.isAsync()) {
    return true;
  }

  const returnType = method.getReturnTypeNode();
  return (
    returnType !== undefined &&
    Node.isTypeReference(returnType) &&
    returnType.getTypeName().getText() === "Promise"
  );
}

/**
 * Whether the handler's declared return type proves a synchronous return.
 *
 * TypeScript emits `design:returntype` from the annotation, and the runtime
 * classifies `Promise` as Promise-capable while `Object` and `undefined` prove
 * nothing. Of the annotations whose text settles that constructor, only the
 * primitive keywords do: they are always emitted as `String`, `Number`,
 * `Boolean`, `BigInt`, or `Symbol`. An annotation naming a class may reach the
 * runtime as that class, but it may equally name an interface or a type alias,
 * which reach it as `Object` — so it is not proof and is reported as no proof.
 */
function readsSynchronousReturn(method: MethodDeclaration): boolean {
  if (method.isAsync()) {
    return false;
  }

  const returnType = method.getReturnTypeNode();
  return (
    returnType !== undefined &&
    (Node.isStringKeyword(returnType) ||
      Node.isNumberKeyword(returnType) ||
      Node.isBooleanKeyword(returnType) ||
      returnType.getKind() === SyntaxKind.BigIntKeyword ||
      Node.isSymbolKeyword(returnType))
  );
}

/**
 * Reads the validation schema one route decorator declares, or `undefined` when
 * it declares none.
 *
 * The documented arities carry the schema in one of two places: the second
 * argument of `(path, schema)`, or the only argument of `(schema)`, where the
 * object literal itself is the schema and the path is empty. Which argument
 * holds the schema therefore follows from the shape the path reader accepts, and
 * a decorator that declares neither a path nor a schema has none.
 */
function readRouteSchema(
  use: AponiaDecoratorUse,
  imports: SourceImports,
  filePath: string,
): AnalyzedRouteSchema | undefined {
  const description = describeDecoratorUse(use, filePath);
  const argument = schemaArgument(use);
  if (argument === undefined) {
    return undefined;
  }

  if (!Node.isObjectLiteralExpression(argument)) {
    return Object.freeze({
      slots: Object.freeze([]),
      unreadable: `${description} must declare its schema as an object literal to be read statically.`,
    });
  }

  return readRouteSchemaSlots(argument, imports, description);
}

function schemaArgument(use: AponiaDecoratorUse): Node | undefined {
  const [, schema] = use.arguments;
  if (schema !== undefined) {
    return schema;
  }

  const [only] = use.arguments;
  return use.arguments.length === 1 && Node.isObjectLiteralExpression(only) ? only : undefined;
}

/**
 * Reads each slot of a schema object literal.
 *
 * Only a property assignment names a slot the analysis can act on. A spread may
 * declare any slot, and a computed key, a method, or an accessor assigns a value
 * this analysis cannot see the slot name for, so both are reported: treating
 * them as absent would make a schema look like one that declares nothing. A key
 * that is not a slot at all is ignored, because the runtime drops it too.
 *
 * A property assignment whose value is missing entirely — `{ body: }` — is
 * reported as well, because there is no expression to copy and the runtime reads
 * the slot as `undefined` rather than as absent.
 *
 * A slot declared twice keeps the last value, which is what the runtime reads
 * from the same object literal.
 */
function readRouteSchemaSlots(
  argument: ObjectLiteralExpression,
  imports: SourceImports,
  description: string,
): AnalyzedRouteSchema {
  const slots = new Map<AnalyzedRouteSchemaSlotName, AnalyzedRouteSchemaSlot>();
  let unreadable: string | undefined;

  for (const property of argument.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      unreadable ??= `${description} spreads its schema, which may declare slots this analysis cannot read.`;
      continue;
    }
    if (!Node.isPropertyAssignment(property)) {
      unreadable ??= `${description} declares a schema slot this analysis cannot read statically.`;
      continue;
    }

    const nameNode = property.getNameNode();
    if (Node.isComputedPropertyName(nameNode)) {
      unreadable ??= `${description} declares a schema slot this analysis cannot read statically.`;
      continue;
    }

    const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
    if (!isRouteSchemaSlotName(name)) {
      continue;
    }

    const initializer = property.getInitializer();
    if (initializer === undefined || initializer.getText().length === 0) {
      // A property assignment with no value at all: `{ body: }`. The runtime
      // hands `undefined` to the platform, so there is nothing to emit again.
      unreadable ??= `${description} declares its "${name}" schema slot with no value.`;
      continue;
    }

    const slot = readRouteSchemaSlot(initializer, name, imports, description);
    slots.set(name, slot);
    unreadable ??= slot.unreadable;
  }

  return Object.freeze({
    slots: Object.freeze(
      routeSchemaSlotNames.flatMap((name) => {
        const slot = slots.get(name);
        return slot === undefined ? [] : [slot];
      }),
    ),
    unreadable,
  });
}

/**
 * Reads one slot's value as the expression to emit again.
 *
 * Reading is all this does: the value is kept exactly as written, and whether it
 * can be reproduced in generated source is decided by the names it reads, which
 * a generated module has to import. An emitter reads those names from the
 * expression again through the same rule.
 */
function readRouteSchemaSlot(
  initializer: Node,
  slot: AnalyzedRouteSchemaSlotName,
  imports: SourceImports,
  description: string,
): AnalyzedRouteSchemaSlot {
  const reading = readExpressionImports(initializer, imports, `${description}'s "${slot}" schema`);

  return Object.freeze({
    slot,
    expression: initializer.getText(),
    unreadable: reading.unreadable,
  });
}

/** Whether a key names a slot a route schema declares. */
function isRouteSchemaSlotName(name: string): name is AnalyzedRouteSchemaSlotName {
  return routeSchemaSlotNames.some((slot) => slot === name);
}

function readDecoratorUse(
  decorator: Decorator,
  bindings: AponiaDecoratorBindings,
): AponiaDecoratorUse | undefined {
  const call = decorator.getCallExpression();
  if (!call) {
    return undefined;
  }

  const name = readDecoratorName(call.getExpression(), bindings);
  return name === undefined ? undefined : { name, arguments: call.getArguments() };
}

function readDecoratorName(
  expression: Expression,
  bindings: AponiaDecoratorBindings,
): string | undefined {
  if (Node.isIdentifier(expression)) {
    return bindings.imports.get(expression.getText());
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const target = expression.getExpression();
    if (Node.isIdentifier(target) && bindings.namespaces.has(target.getText())) {
      return expression.getName();
    }
  }

  return undefined;
}

function readStringLiteral(argument: Node, description: string): string {
  if (!Node.isStringLiteral(argument)) {
    throw new Error(`${description} must declare a string literal to be read statically.`);
  }

  return argument.getLiteralValue();
}

function describeDecoratorUse(use: AponiaDecoratorUse, filePath: string): string {
  return `@${use.name} in ${filePath}`;
}
