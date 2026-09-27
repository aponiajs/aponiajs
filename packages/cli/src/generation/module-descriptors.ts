import {
  Node,
  Project,
  type ClassDeclaration,
  type Decorator,
  type Expression,
  type MethodDeclaration,
  type ObjectLiteralElementLike,
  type ParameterDeclaration,
  type PropertyDeclaration,
  type SourceFile,
} from "ts-morph";
import { readExpressionValueNames, substituteExpression } from "./source-imports.ts";
import type { SourceSubstitution } from "./source-imports.ts";
import type {
  AnalyzedConstructorDependency,
  AnalyzedControllerDeclaration,
  AnalyzedGateway,
  AnalyzedGatewayHandler,
  AnalyzedGatewayParameter,
  AnalyzedInjectable,
  AnalyzedModule,
  AnalyzedModuleDescriptors,
  AnalyzedModuleEntry,
  AnalyzedToken,
  AnalyzedValidationModel,
} from "./module-descriptors.types.ts";

const aponiaModuleSpecifier = "@aponiajs/common";
const controllerDecoratorName = "Controller";
const moduleDecoratorName = "Module";
const injectableDecoratorName = "Injectable";
const injectDecoratorName = "Inject";
const gatewayDecoratorName = "WebSocketGateway";
const subscribeMessageDecoratorName = "SubscribeMessage";
const messageBodyDecoratorName = "MessageBody";
const connectedSocketDecoratorName = "ConnectedSocket";
const webSocketServerDecoratorName = "WebSocketServer";
const validationDecoratorName = "Validation";
const injectionTokenFactoryName = "createToken";

/**
 * The path `@WebSocketGateway()` falls back to when it declares none.
 *
 * Mirrors `normalizeGatewayPath` in `@aponiajs/common`
 * (`packages/common/src/websockets/websocket-gateway.ts`), including its
 * rejection of an empty path.
 */
const defaultGatewayPath = "/ws";

/**
 * The options `@Module()` reads, which are exactly `ModuleMetadata`'s
 * collections in `@aponiajs/common`
 * (`packages/common/src/decorators/decorators.types.ts`).
 */
const moduleCollectionNames = ["imports", "controllers", "providers", "exports"] as const;

type ModuleCollectionName = (typeof moduleCollectionNames)[number];

const noDescriptors: AnalyzedModuleDescriptors = Object.freeze({
  modules: Object.freeze([]),
  controllers: Object.freeze([]),
  injectables: Object.freeze([]),
  gateways: Object.freeze([]),
  validationModels: Object.freeze([]),
});

const noDependencies: DependencyReading = Object.freeze({
  dependencies: Object.freeze([]),
  reasons: Object.freeze([]),
});

/**
 * What a source file imports from `@aponiajs/common`.
 *
 * A decorator is Aponia's only when the file binds the decorator's name to that
 * exact module specifier, either through a named import or through a namespace
 * import. Matching by name alone would treat a same-named decorator from another
 * package as Aponia's, and would accept a file that never imports the framework
 * at all. A file that imports nothing from `@aponiajs/common` therefore yields
 * no declarations.
 *
 * Mirrors `AponiaDecoratorBindings` and `collectAponiaDecoratorBindings` in
 * `controller-routes.ts`, which owns the same rule for route analysis. This
 * module repeats them because that file's copy is private to it; keep the two in
 * step by hand.
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

/** The collections one `@Module()` options object declares. */
interface ModuleCollectionsReading {
  readonly imports: readonly AnalyzedModuleEntry[];
  readonly controllers: readonly AnalyzedModuleEntry[];
  readonly providers: readonly AnalyzedModuleEntry[];
  readonly exports: readonly AnalyzedModuleEntry[];
  /** Every reason a collection could not be read. */
  readonly reasons: readonly string[];
}

/** The path one `@WebSocketGateway()` declares, or why it could not be read. */
interface GatewayPathReading {
  readonly value: string | undefined;
  readonly reason: string | undefined;
}

/** The constructor dependencies one class declares, and why any could not be read. */
interface DependencyReading {
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  readonly reasons: readonly string[];
}

/**
 * Reads one source file into the module declarations a descriptor emitter will
 * lower.
 *
 * Analysis is static and exact: it parses `source` with `ts-morph` and never
 * evaluates it, so a module, controller, provider, or gateway that only exists
 * after a side effect is invisible to it. Decorators are matched against the
 * `@aponiajs/common` import of the same file, results follow declaration order,
 * and every returned object is frozen. Controllers are read for their
 * constructor dependencies alone; their routes belong to
 * `analyzeControllerRoutes`.
 *
 * Readable means the analysis can write the same thing again: an identifier, a
 * property access, a `createToken(...)` call, or an array literal of them. A
 * declaration that is legal Aponia but whose value only exists at run time — a
 * module's options built from a variable, a token that is neither a reference
 * nor a `createToken(...)` call — is reported in the declaration's `unreadable`
 * list rather than dropped, because an omission there is indistinguishable from
 * a declaration that genuinely has nothing in it. Its consumer declines those
 * declarations and leaves them on the runtime's own compile path.
 *
 * A `@Validation()` model is read the same way. The analysis reports the
 * validator the decorator declares rather than the class the runtime would
 * resolve through it, and it folds the model file's own module-scope constants
 * into that expression, because a generated module can neither name a binding
 * the file does not export nor import one it does not declare.
 *
 * A decorator whose arguments contradict its documented signature throws a plain
 * `Error`, as does a gateway path the runtime itself rejects as empty. A bare
 * `@Module` or `@Injectable` that is never called is ignored, because the
 * framework's decorator factories must be invoked to record anything.
 *
 * @param source - The full text of one source file.
 * @param filePath - The file's path, used only to describe failures.
 */
export function analyzeModuleDescriptors(
  source: string,
  filePath: string,
): AnalyzedModuleDescriptors {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, source);
  const bindings = collectAponiaDecoratorBindings(sourceFile);
  if (bindings.imports.size === 0 && bindings.namespaces.size === 0) {
    return noDescriptors;
  }

  const modules: AnalyzedModule[] = [];
  const controllers: AnalyzedControllerDeclaration[] = [];
  const injectables: AnalyzedInjectable[] = [];
  const gateways: AnalyzedGateway[] = [];
  const validationModels: AnalyzedValidationModel[] = [];
  const modelConstants = readModelConstants(sourceFile);

  for (const declaration of sourceFile.getClasses()) {
    const uses = readDecoratorUses(declaration, bindings);

    const moduleUse = uses.find((use) => use.name === moduleDecoratorName);
    if (moduleUse) {
      modules.push(analyzeModule(declaration, moduleUse, bindings, filePath));
    }

    const controllerUse = uses.find((use) => use.name === controllerDecoratorName);
    if (controllerUse) {
      controllers.push(analyzeControllerDeclaration(declaration, bindings, filePath));
    }

    const injectableUse = uses.find((use) => use.name === injectableDecoratorName);
    if (injectableUse) {
      injectables.push(analyzeInjectable(declaration, injectableUse, bindings, filePath));
    }

    const gatewayUse = uses.find((use) => use.name === gatewayDecoratorName);
    if (gatewayUse) {
      gateways.push(analyzeGateway(declaration, gatewayUse, bindings, filePath));
    }

    const validationUse = uses.find((use) => use.name === validationDecoratorName);
    if (validationUse) {
      validationModels.push(
        analyzeValidationModel(declaration, validationUse, modelConstants, filePath),
      );
    }
  }

  return Object.freeze({
    modules: Object.freeze(modules),
    controllers: Object.freeze(controllers),
    injectables: Object.freeze(injectables),
    gateways: Object.freeze(gateways),
    validationModels: Object.freeze(validationModels),
  });
}

/**
 * Reads one class into a controller declaration when Aponia's `@Controller`
 * decorates it.
 *
 * The path and the routes belong to the route analysis, which owns the decorator
 * shapes that declare them. All this reads is what the container needs to build
 * the class, so a file whose controller declares no constructor is reported as
 * having no dependencies rather than being left out.
 */
function analyzeControllerDeclaration(
  declaration: ClassDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedControllerDeclaration {
  const dependencies = readDependencies(declaration, bindings, filePath);

  return Object.freeze({
    className: readClassName(declaration),
    dependencies: dependencies.dependencies,
    unreadable: dependencies.reasons,
  });
}

/**
 * Reads the decorator names a file imports from `@aponiajs/common`. Named
 * imports are recorded under their local alias, so
 * `import { Module as Declare } from "@aponiajs/common"` recognizes `@Declare()`.
 *
 * Mirrors `collectAponiaDecoratorBindings` in `controller-routes.ts`.
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
 * Reads every recognized decorator a class carries.
 *
 * A decorator that is applied more than once resolves to the first recognized
 * use, which is the one the runtime records: decorators are applied bottom-up,
 * so the topmost call is the last to write its metadata.
 */
function readDecoratorUses(
  declaration: ClassDeclaration,
  bindings: AponiaDecoratorBindings,
): readonly AponiaDecoratorUse[] {
  const uses: AponiaDecoratorUse[] = [];
  for (const decorator of declaration.getDecorators()) {
    const use = readDecoratorUse(decorator, bindings);
    if (use !== undefined) {
      uses.push(use);
    }
  }

  return uses;
}

/**
 * Reads one class into a module descriptor when Aponia's `@Module` decorates it.
 *
 * `@Module` takes exactly one options object. Every collection it declares is
 * read as written, and a collection it cannot read leaves the module reported
 * rather than empty.
 */
function analyzeModule(
  declaration: ClassDeclaration,
  use: AponiaDecoratorUse,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedModule {
  const description = describeDecoratorUse(use, filePath);
  const options = readOnlyArgument(use, description, "exactly one options object");
  const collections = readModuleCollections(options, bindings, description);
  const dependencies = readDependencies(declaration, bindings, filePath);

  return Object.freeze({
    className: readClassName(declaration),
    imports: collections.imports,
    controllers: collections.controllers,
    providers: collections.providers,
    exports: collections.exports,
    dependencies: dependencies.dependencies,
    collectionUnreadable: collections.reasons,
    unreadable: Object.freeze([...collections.reasons, ...dependencies.reasons]),
  });
}

/** Reads one class into an injectable declaration when `@Injectable()` decorates it. */
function analyzeInjectable(
  declaration: ClassDeclaration,
  use: AponiaDecoratorUse,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedInjectable {
  if (use.arguments.length > 0) {
    throw new Error(`${describeDecoratorUse(use, filePath)} must not declare arguments.`);
  }

  const dependencies = readDependencies(declaration, bindings, filePath);

  return Object.freeze({
    className: readClassName(declaration),
    dependencies: dependencies.dependencies,
    unreadable: dependencies.reasons,
  });
}

/**
 * Reads one class into a gateway declaration when Aponia's `@WebSocketGateway`
 * decorates it.
 *
 * The path comes from the class decorator and the handlers and server properties
 * from the member decorators, which is the whole of what the runtime discovers
 * by reflecting on a gateway. A gateway a generated module declares states the
 * same facts as data, and a consumer therefore has to read them here: a plan
 * that dropped a handler would answer for the application with a silent gap.
 */
function analyzeGateway(
  declaration: ClassDeclaration,
  use: AponiaDecoratorUse,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedGateway {
  const description = describeDecoratorUse(use, filePath);
  if (use.arguments.length > 1) {
    throw new Error(`${description} must declare at most one path or options object.`);
  }

  const path = readGatewayPath(use.arguments.at(0), description);
  const dependencies = readDependencies(declaration, bindings, filePath);
  const handlers = readGatewayHandlers(declaration, bindings, filePath);
  const serverProperties = readGatewayServerProperties(declaration, bindings, filePath);
  const reasons = [
    ...(path.reason === undefined ? [] : [path.reason]),
    ...dependencies.reasons,
    ...handlers.reasons,
    ...serverProperties.reasons,
  ];

  return Object.freeze({
    className: readClassName(declaration),
    path: path.value,
    dependencies: dependencies.dependencies,
    handlers: handlers.handlers,
    serverProperties: serverProperties.properties,
    unreadable: Object.freeze(reasons),
  });
}

/** The handlers one gateway class declares, and why any could not be read. */
interface GatewayHandlersReading {
  readonly handlers: readonly AnalyzedGatewayHandler[];
  readonly reasons: readonly string[];
}

/**
 * Reads the message handlers a gateway class declares.
 *
 * Only the class's own methods are read, which is what the runtime discovers
 * too: `@SubscribeMessage()` writes its metadata on the prototype it decorates
 * and the platform reads own metadata, so a handler a base class declares is not
 * a handler of the gateway that extends it.
 */
function readGatewayHandlers(
  declaration: ClassDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): GatewayHandlersReading {
  const handlers: AnalyzedGatewayHandler[] = [];
  const reasons: string[] = [];

  for (const method of declaration.getMethods()) {
    // A static method never reaches the runtime: `@SubscribeMessage()` throws
    // while the class is being defined, because it decorates the constructor
    // rather than the prototype.
    if (method.isStatic()) {
      continue;
    }

    const readings = readGatewayHandler(method, bindings, filePath);
    if (readings === undefined) {
      continue;
    }
    if (readings.handler !== undefined) {
      handlers.push(readings.handler);
    }
    reasons.push(...readings.reasons);
  }

  return Object.freeze({
    handlers: Object.freeze(handlers),
    reasons: Object.freeze(reasons),
  });
}

/**
 * Reads one gateway method.
 *
 * A method with no `@SubscribeMessage()` is not a handler, and is skipped rather
 * than reported: the runtime registers message handlers and nothing else, and a
 * lifecycle method such as `afterInit` is discovered from the instance when the
 * gateway is bound.
 */
function readGatewayHandler(
  method: MethodDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
):
  | { readonly handler: AnalyzedGatewayHandler | undefined; readonly reasons: readonly string[] }
  | undefined {
  const uses = method
    .getDecorators()
    .map((decorator) => readDecoratorUse(decorator, bindings))
    .filter((use) => use !== undefined);
  const events = uses.filter((use) => use.name === subscribeMessageDecoratorName);
  if (events.length === 0) {
    return undefined;
  }

  const name = readMemberName(method);
  const description = `@${subscribeMessageDecoratorName} on ${describeMember(method, filePath)}`;
  if (events.length > 1) {
    return {
      handler: undefined,
      reasons: Object.freeze([
        `${description} declares more than one event, and a generated gateway states one handler per method.`,
      ]),
    };
  }

  const event = readSubscribeEvent(events[0]!, description);
  const parameters = readGatewayParameters(method, bindings, description);
  const reasons = [...(event.reason === undefined ? [] : [event.reason]), ...parameters.reasons];
  if (name === undefined) {
    reasons.push(
      `${description} is declared under a name that is not a plain property key, so a generated gateway cannot look it up.`,
    );
  }
  if (event.value === undefined || name === undefined) {
    return { handler: undefined, reasons: Object.freeze(reasons) };
  }

  return {
    handler: Object.freeze({
      event: event.value,
      propertyKey: name,
      parameters: parameters.parameters,
    }),
    reasons: Object.freeze(reasons),
  };
}

/** The event one `@SubscribeMessage()` declares, or why it could not be read. */
function readSubscribeEvent(use: AponiaDecoratorUse, description: string): NodeReading {
  const argument = use.arguments.at(0);
  return use.arguments.length === 1 && Node.isStringLiteral(argument)
    ? { value: argument.getLiteralValue(), reason: undefined }
    : {
        value: undefined,
        reason: `${description} declares an event this analysis cannot read statically.`,
      };
}

/**
 * Reads the parameters one handler's WebSocket decorators bind.
 *
 * A parameter with no such decorator is left out, which is what the platform
 * passes it: the invoker emits one argument per decorated parameter, so an
 * undecorated parameter receives `undefined` from both paths.
 */
function readGatewayParameters(
  method: MethodDeclaration,
  bindings: AponiaDecoratorBindings,
  description: string,
): {
  readonly parameters: readonly AnalyzedGatewayParameter[];
  readonly reasons: readonly string[];
} {
  const parameters: AnalyzedGatewayParameter[] = [];
  const reasons: string[] = [];

  for (const [index, parameter] of method.getParameters().entries()) {
    const uses = parameter
      .getDecorators()
      .map((decorator) => readDecoratorUse(decorator, bindings))
      .filter((use) => use !== undefined)
      .filter(
        (use) => use.name === messageBodyDecoratorName || use.name === connectedSocketDecoratorName,
      );
    if (uses.length === 0) {
      continue;
    }
    if (uses.length > 1) {
      reasons.push(
        `${description} binds the parameter at index ${index} more than once, which the platform rejects at startup.`,
      );
      continue;
    }

    const use = uses[0]!;
    if (use.name === connectedSocketDecoratorName) {
      if (use.arguments.length > 0) {
        reasons.push(
          `${description} declares @${connectedSocketDecoratorName}(...) with arguments.`,
        );
        continue;
      }
      parameters.push(Object.freeze({ index, kind: "connected-socket", property: undefined }));
      continue;
    }

    const property = readMessageBodyProperty(use, index, description);
    if (property.reason !== undefined) {
      reasons.push(property.reason);
      continue;
    }
    parameters.push(Object.freeze({ index, kind: "message-body", property: property.value }));
  }

  return Object.freeze({
    parameters: Object.freeze(parameters),
    reasons: Object.freeze(reasons),
  });
}

/** The property one `@MessageBody()` names, or why it could not be read. */
function readMessageBodyProperty(
  use: AponiaDecoratorUse,
  index: number,
  description: string,
): NodeReading {
  const argument = use.arguments.at(0);
  if (argument === undefined) {
    return { value: undefined, reason: undefined };
  }
  if (use.arguments.length === 1 && Node.isStringLiteral(argument)) {
    return { value: argument.getLiteralValue(), reason: undefined };
  }

  return {
    value: undefined,
    reason: `${description} binds the parameter at index ${index} to a message property this analysis cannot read statically.`,
  };
}

/**
 * Reads the instance properties `@WebSocketServer()` marks.
 *
 * The property is where the platform writes the root application, so a name it
 * cannot reproduce is reported: a plan that dropped one would leave the property
 * `undefined` where the decorator path assigns the server.
 */
function readGatewayServerProperties(
  declaration: ClassDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): { readonly properties: readonly string[]; readonly reasons: readonly string[] } {
  const properties: string[] = [];
  const reasons: string[] = [];

  for (const property of declaration.getProperties()) {
    const uses = property
      .getDecorators()
      .map((decorator) => readDecoratorUse(decorator, bindings))
      .filter((use) => use !== undefined && use.name === webSocketServerDecoratorName);
    if (uses.length === 0) {
      continue;
    }

    const name = readMemberName(property);
    if (name === undefined) {
      reasons.push(
        `@${webSocketServerDecoratorName} on ${describeMember(property, filePath)} is declared under a name that is not a plain property key, so a generated gateway cannot assign it.`,
      );
      continue;
    }

    properties.push(name);
  }

  return Object.freeze({
    properties: Object.freeze(properties),
    reasons: Object.freeze(reasons),
  });
}

/**
 * Reads one class into a validation model when Aponia's `@Validation` decorates
 * it, folding the model file's own constants into the validator it declares.
 */
function analyzeValidationModel(
  declaration: ClassDeclaration,
  use: AponiaDecoratorUse,
  constants: ReadonlyMap<string, Node>,
  filePath: string,
): AnalyzedValidationModel {
  const className = readClassName(declaration);
  const description = `The validator of the model ${className} in ${filePath}`;
  const validator = readOnlyArgument(
    use,
    `@${validationDecoratorName} on ${describeClass(declaration, filePath)}`,
    "exactly one validator",
  );
  const inlined = inlineModelConstants(validator, constants, [], description);

  return Object.freeze({
    className,
    validator: inlined.expression,
    unreadable: Object.freeze(inlined.reason === undefined ? [] : [inlined.reason]),
  });
}

/**
 * The module-scope constants a validator may read by name.
 *
 * A generated module can import what a file exports and copy an expression
 * verbatim, but a module-private binding has no second copy: nothing outside the
 * file that declares it can name it. A `@Validation()` model is written into
 * another file, so its validator has to carry those constants with it.
 *
 * Only `const` declarations qualify. A `let` or a `var` can be reassigned after
 * the decorator ran, so its initializer is not necessarily the value the
 * validator read, and a binding a generated module inlined there would be a
 * guess rather than the value the application has.
 */
function readModelConstants(sourceFile: SourceFile): ReadonlyMap<string, Node> {
  const constants = new Map<string, Node>();

  for (const statement of sourceFile.getVariableStatements()) {
    if (statement.isExported() || statement.getDeclarationKind() !== "const") {
      continue;
    }

    for (const declaration of statement.getDeclarations()) {
      const nameNode = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (Node.isIdentifier(nameNode) && initializer !== undefined) {
        constants.set(nameNode.getText(), initializer);
      }
    }
  }

  return constants;
}

/**
 * Rewrites one validator expression so that every module-private constant it
 * reads is replaced by what that constant was initialized with.
 *
 * The substitution is recursive because a constant may read another one —
 * `t.Partial(createUserSchema)` is the shape this exists for — and a cycle among
 * them is reported rather than followed: a binding that reads itself cannot
 * produce a value at all, so there is nothing to copy.
 */
function inlineModelConstants(
  node: Node,
  constants: ReadonlyMap<string, Node>,
  inlining: readonly string[],
  description: string,
): ValidationReading {
  const substitutions: SourceSubstitution[] = [];

  for (const identifier of readExpressionValueNames(node)) {
    const name = identifier.getText();
    const initializer = constants.get(name);
    if (initializer === undefined) {
      continue;
    }
    if (inlining.includes(name)) {
      return {
        expression: undefined,
        reason: `${description} reads "${name}" through a cycle of constants, which cannot be resolved.`,
      };
    }

    const nested = inlineModelConstants(initializer, constants, [...inlining, name], description);
    if (nested.expression === undefined) {
      return nested;
    }
    substitutions.push({ identifier, text: nested.expression });
  }

  return {
    expression: substituteExpression(node, substitutions),
    reason: undefined,
  };
}

/** A value the analysis read, or why it could not read one. */
interface NodeReading {
  readonly value: string | undefined;
  readonly reason: string | undefined;
}

/** A validator expression, or why the analysis could not reproduce it. */
interface ValidationReading {
  readonly expression: string | undefined;
  readonly reason: string | undefined;
}

/**
 * Reads the collections one `@Module()` options object declares.
 *
 * A collection that is not an array literal cannot be read, and it is reported
 * rather than treated as empty: the runtime accepts any array value, so an empty
 * result here would be indistinguishable from a module that declares nothing.
 */
function readModuleCollections(
  options: Node,
  bindings: AponiaDecoratorBindings,
  description: string,
): ModuleCollectionsReading {
  const imports: AnalyzedModuleEntry[] = [];
  const controllers: AnalyzedModuleEntry[] = [];
  const providers: AnalyzedModuleEntry[] = [];
  const exports: AnalyzedModuleEntry[] = [];
  const reasons: string[] = [];
  const collections: Record<ModuleCollectionName, AnalyzedModuleEntry[]> = {
    imports,
    controllers,
    providers,
    exports,
  };

  if (Node.isObjectLiteralExpression(options)) {
    for (const property of options.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        reasons.push(
          `${description} spreads its options, which may declare collections this analysis cannot read.`,
        );
        continue;
      }

      const name = readPropertyName(property);
      if (name === undefined) {
        reasons.push(`${description} declares an option this analysis cannot read statically.`);
        continue;
      }
      if (!isModuleCollectionName(name)) {
        continue;
      }

      readModuleCollection(property, name, collections[name], bindings, description, reasons);
    }
  } else {
    reasons.push(
      `${description} declares options this analysis cannot read statically; write the object literal inline.`,
    );
  }

  return Object.freeze({
    imports: Object.freeze(imports),
    controllers: Object.freeze(controllers),
    providers: Object.freeze(providers),
    exports: Object.freeze(exports),
    reasons: Object.freeze(reasons),
  });
}

/**
 * Whether a name is one of the collections `@Module()` reads. Every other key is
 * dropped by the runtime, so a property that declares none of them is ignored
 * here too.
 */
function isModuleCollectionName(name: string): name is ModuleCollectionName {
  return moduleCollectionNames.some((entry) => entry === name);
}

/**
 * The name a property assigns, or `undefined` when it has none this analysis can
 * read.
 *
 * A computed name is a run-time value, so which option it assigns is unknown,
 * and a method or accessor assigns a function rather than a value. Both are
 * reported by the caller: they could be assigning any collection, and treating
 * them as absent would make the module look like one that declares nothing.
 */
function readPropertyName(property: ObjectLiteralElementLike): string | undefined {
  if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
    return undefined;
  }

  // Widened so the computed-name test below is a real narrowing rather than a
  // comparison the declared node union already answers.
  const nameNode: Node = property.getNameNode();
  if (Node.isComputedPropertyName(nameNode)) {
    return undefined;
  }

  return Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText();
}

/**
 * Reads one collection of a `@Module()` options object element by element.
 *
 * A shorthand property carries its value as a variable rather than in the
 * literal, so it cannot be read either, and it is reported for the same reason a
 * non-literal value is.
 */
function readModuleCollection(
  property: ObjectLiteralElementLike,
  name: ModuleCollectionName,
  entries: AnalyzedModuleEntry[],
  bindings: AponiaDecoratorBindings,
  description: string,
  reasons: string[],
): void {
  if (!Node.isPropertyAssignment(property)) {
    reasons.push(`${description} declares "${name}" outside its options literal.`);
    return;
  }

  const initializer = property.getInitializer();
  if (!Node.isArrayLiteralExpression(initializer)) {
    reasons.push(
      `${description} must declare "${name}" as an array literal to be read statically.`,
    );
    return;
  }

  for (const element of initializer.getElements()) {
    const entry = readModuleEntry(element, bindings, description, name === "exports");
    entries.push(entry);
    if (entry.unreadable !== undefined) {
      reasons.push(entry.unreadable);
    }
  }
}

/**
 * Reads one element of a module collection.
 *
 * `imports`, `controllers`, and `providers` accept any expression the emitter can
 * copy into generated source: an identifier, a property access, or a call such
 * as `provideValue(...)`. `exports` names tokens, whose readable forms are
 * narrower — see {@link readToken}.
 */
function readModuleEntry(
  element: Expression,
  bindings: AponiaDecoratorBindings,
  description: string,
  tokenPosition: boolean,
): AnalyzedModuleEntry {
  const expression = element.getText();
  if (Node.isSpreadElement(element)) {
    return unreadableEntry(
      expression,
      `${description} spreads a collection element, which this analysis cannot read.`,
    );
  }

  if (tokenPosition) {
    return readToken(element, bindings) === undefined
      ? unreadableEntry(expression, unreadableTokenReason(description))
      : Object.freeze({ expression, unreadable: undefined });
  }

  return isCopyableExpression(element)
    ? Object.freeze({ expression, unreadable: undefined })
    : unreadableEntry(
        expression,
        `${description} declares an expression this analysis cannot read statically.`,
      );
}

/**
 * Whether an element outside a token position is an expression the emitter can
 * write again. A conditional, an object literal, or any other computed value
 * would have to be re-derived rather than copied.
 */
function isCopyableExpression(element: Expression): boolean {
  return (
    Node.isIdentifier(element) ||
    Node.isPropertyAccessExpression(element) ||
    Node.isCallExpression(element)
  );
}

/**
 * Reads a token expression.
 *
 * Only two forms have a static identity: a bare identifier, which names the
 * class or the binding the token is, and a direct `createToken(...)` call from
 * `@aponiajs/common`. A token built any other way has nothing to reproduce in
 * generated source, so it is reported instead of guessed at.
 */
function readToken(expression: Node, bindings: AponiaDecoratorBindings): AnalyzedToken | undefined {
  if (Node.isIdentifier(expression)) {
    return Object.freeze({ expression: expression.getText(), kind: "reference" });
  }

  const isInjectionToken =
    Node.isCallExpression(expression) &&
    readAponiaName(expression.getExpression(), bindings) === injectionTokenFactoryName;

  return isInjectionToken
    ? Object.freeze({ expression: expression.getText(), kind: "injection-token" })
    : undefined;
}

/**
 * Reads the path a `@WebSocketGateway()` decorator declares.
 *
 * The documented arities are `()`, `(path)`, and `(options)`. An omitted path
 * defaults to `/ws`, and an empty one is rejected here because the runtime
 * rejects it too. A path the analysis cannot read — a variable, a value read
 * from another object, an options key it cannot name — is reported rather than
 * defaulted, so a consumer declines the gateway instead of emitting a path the
 * application did not write.
 */
function readGatewayPath(argument: Node | undefined, description: string): GatewayPathReading {
  if (argument === undefined) {
    return { value: defaultGatewayPath, reason: undefined };
  }

  if (Node.isStringLiteral(argument)) {
    return {
      value: readGatewayPathLiteral(argument.getLiteralValue(), description),
      reason: undefined,
    };
  }

  if (!Node.isObjectLiteralExpression(argument)) {
    return unreadableGatewayPath(description);
  }

  const properties = argument.getProperties();
  if (properties.some((property) => readPropertyName(property) === undefined)) {
    return unreadableGatewayPath(description);
  }

  const pathProperty = properties.find((property) => readPropertyName(property) === "path");
  if (pathProperty === undefined) {
    return { value: defaultGatewayPath, reason: undefined };
  }

  const initializer = Node.isPropertyAssignment(pathProperty)
    ? pathProperty.getInitializer()
    : undefined;
  return Node.isStringLiteral(initializer)
    ? {
        value: readGatewayPathLiteral(initializer.getLiteralValue(), description),
        reason: undefined,
      }
    : unreadableGatewayPath(description);
}

/**
 * Rejects an empty path for the same reason the runtime does, so the analysis
 * never reports a path the framework would refuse at startup.
 */
function readGatewayPathLiteral(path: string, description: string): string {
  if (path.length === 0) {
    throw new Error(`${description} must declare a non-empty path.`);
  }

  return path;
}

function unreadableGatewayPath(description: string): GatewayPathReading {
  return {
    value: undefined,
    reason: `${description} declares a path this analysis cannot read statically.`,
  };
}

/**
 * Reads the constructor dependencies the container resolves for a class.
 *
 * An explicit `@Inject()` token is read where the file names one, and the
 * declared parameter type is read otherwise, which is what the runtime falls
 * back to through `design:paramtypes`.
 *
 * A class that declares no constructor but extends another one inherits both,
 * and neither is visible from this file, so it is reported rather than read as a
 * class with no dependencies.
 */
function readDependencies(
  declaration: ClassDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): DependencyReading {
  // A class with overloaded constructors declares its implementation last, and
  // `design:paramtypes` is emitted from that signature, so the last declaration
  // is the one the container resolves.
  const constructor = declaration.getConstructors().at(-1);
  if (constructor === undefined) {
    const base = declaration.getExtends();
    return base === undefined
      ? noDependencies
      : Object.freeze({
          dependencies: noDependencies.dependencies,
          reasons: Object.freeze([
            `${describeClass(declaration, filePath)} declares no constructor but extends ` +
              `${base.getExpression().getText()}, so its dependencies come from a class this analysis does not read.`,
          ]),
        });
  }

  const dependencies: AnalyzedConstructorDependency[] = [];
  const reasons: string[] = [];
  for (const [index, parameter] of constructor.getParameters().entries()) {
    const dependency = readDependency(index, parameter, bindings, filePath);
    dependencies.push(dependency);
    if (dependency.source === "unreadable") {
      reasons.push(dependency.reason);
    }
  }

  return Object.freeze({
    dependencies: Object.freeze(dependencies),
    reasons: Object.freeze(reasons),
  });
}

/**
 * Reads one constructor parameter. A parameter carries its token either through
 * `@Inject()`, which wins, or through its declared type.
 */
function readDependency(
  index: number,
  parameter: ParameterDeclaration,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedConstructorDependency {
  const injectUse = parameter
    .getDecorators()
    .map((decorator) => readDecoratorUse(decorator, bindings))
    .find((use) => use?.name === injectDecoratorName);
  if (injectUse !== undefined) {
    return readInjectedDependency(index, injectUse, bindings, filePath);
  }

  const typeNode = parameter.getTypeNode();
  return typeNode === undefined
    ? Object.freeze({
        index,
        source: "unreadable",
        reason: `The constructor parameter at index ${index} in ${filePath} declares no type and no @Inject() token.`,
      })
    : Object.freeze({ index, source: "type", type: typeNode.getText() });
}

/** Reads one `@Inject()` dependency, whose documented arity is one token. */
function readInjectedDependency(
  index: number,
  use: AponiaDecoratorUse,
  bindings: AponiaDecoratorBindings,
  filePath: string,
): AnalyzedConstructorDependency {
  const description = describeDecoratorUse(use, filePath);
  const argument = readOnlyArgument(use, description, "exactly one token");
  const token = readToken(argument, bindings);

  return token === undefined
    ? Object.freeze({
        index,
        source: "unreadable",
        reason: unreadableTokenReason(description),
      })
    : Object.freeze({ index, source: "inject", token });
}

/** Reads the only argument a decorator's documented arity allows. */
function readOnlyArgument(use: AponiaDecoratorUse, description: string, expectation: string): Node {
  const argument = use.arguments.at(0);
  if (use.arguments.length !== 1 || argument === undefined) {
    throw new Error(`${description} must declare ${expectation}.`);
  }

  return argument;
}

function unreadableEntry(expression: string, unreadable: string): AnalyzedModuleEntry {
  return Object.freeze({ expression, unreadable });
}

function unreadableTokenReason(description: string): string {
  return `${description} names a token this analysis cannot read statically; use a class reference or createToken(...).`;
}

function readClassName(declaration: ClassDeclaration): string {
  return declaration.getName() ?? "";
}

/**
 * The property key a class member declares, or `undefined` when a generated
 * gateway cannot name it.
 *
 * A plan addresses a member by the key the runtime looks it up by —
 * `instance[propertyKey]` — so only a plain identifier can be written back. A
 * computed name reaches the analysis as its own source text, a string literal
 * keeps its quotes, and a private name is unreachable, so each of them is
 * reported instead of being copied into a key no member has.
 */
function readMemberName(member: MethodDeclaration | PropertyDeclaration): string | undefined {
  const name = member.getNameNode();
  return Node.isIdentifier(name) ? name.getText() : undefined;
}

/**
 * How one class member is named in a reported reason. The reasons this appears
 * in are sentences — `@SubscribeMessage on the method findAll in <file> declares
 * ...` — so the member is described rather than quoted.
 */
function describeMember(member: MethodDeclaration | PropertyDeclaration, filePath: string): string {
  const kind = Node.isMethodDeclaration(member) ? "method" : "property";
  return `the ${kind} ${member.getName()} in ${filePath}`;
}

function describeClass(declaration: ClassDeclaration, filePath: string): string {
  const name = declaration.getName();
  return name === undefined ? `The class in ${filePath}` : `The class ${name} in ${filePath}`;
}

function readDecoratorUse(
  decorator: Decorator,
  bindings: AponiaDecoratorBindings,
): AponiaDecoratorUse | undefined {
  const call = decorator.getCallExpression();
  if (!call) {
    return undefined;
  }

  const name = readAponiaName(call.getExpression(), bindings);
  return name === undefined ? undefined : { name, arguments: call.getArguments() };
}

/**
 * The name an expression binds to an `@aponiajs/common` export, or `undefined`
 * when the expression is not one. Mirrors `readDecoratorName` in
 * `controller-routes.ts`, generalized to any Aponia export so `createToken` is
 * resolved by the same rule its decorators are.
 */
function readAponiaName(
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

function describeDecoratorUse(use: AponiaDecoratorUse, filePath: string): string {
  return `@${use.name} in ${filePath}`;
}
