import {
  Node,
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type Decorator,
  type Expression,
  type MethodDeclaration,
  type SourceFile,
} from "ts-morph";
import type {
  AnalyzedController,
  AnalyzedRequestMethod,
  AnalyzedRoute,
  AnalyzedRouteParameter,
  AnalyzedRouteParameterKind,
} from "./controller-routes.types.ts";

const aponiaModuleSpecifier = "@aponiajs/common";
const controllerDecoratorName = "Controller";

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
 * exports (`packages/common/src/routing/route-parameters.ts`). `Res` is the
 * documented alias of `Set`, so both bind `"set"`.
 */
const parameterDecorators: ReadonlyMap<string, AnalyzedRouteParameterKind> = new Map([
  ["Body", "body"],
  ["Cookie", "cookie"],
  ["Ctx", "context"],
  ["Headers", "headers"],
  ["Param", "params"],
  ["Query", "query"],
  ["Req", "request"],
  ["Res", "set"],
  ["Set", "set"],
  ["Status", "status"],
  ["Store", "store"],
]);

const noControllers: readonly AnalyzedController[] = Object.freeze([]);
const noRoutes: readonly AnalyzedRoute[] = Object.freeze([]);

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
 * schema of the `(path, schema)` arity is not interpreted: the runtime passes it
 * to the platform unchanged. A bare `@Get` or `@Controller` that is never called
 * is ignored, because the framework's decorator factories must be invoked to
 * record anything.
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

  const controllers = sourceFile
    .getClasses()
    .flatMap((declaration) => analyzeController(declaration, bindings, filePath));
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
  const routes = declaration
    .getMethods()
    .flatMap((method) => analyzeRouteMethod(method, bindings, filePath));

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
  filePath: string,
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
  const declaresParameters = method.getParameters().length > 0;
  const usesArgumentsObject = readsArgumentsObject(method);

  return Object.freeze(
    routes.map(({ use, method: requestMethod }) =>
      Object.freeze({
        method: requestMethod,
        path: readRoutePath(use, filePath),
        methodName,
        promiseCapable,
        declaresParameters,
        usesArgumentsObject,
        parameters,
      }),
    ),
  );
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
