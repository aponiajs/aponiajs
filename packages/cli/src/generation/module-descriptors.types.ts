/**
 * How a token appears in the source the analysis read.
 *
 * Mirrors the two forms `Token` takes in `@aponiajs/common`
 * (`packages/common/src/tokens/token.types.ts`): a class, which is referenced by
 * name, and an `InjectionToken`, which `createToken` builds. The CLI is
 * independent of the runtime packages, so the union is declared locally and
 * must be kept in step with that source by hand.
 */
export type AnalyzedTokenKind = "reference" | "injection-token";

/**
 * A token the analysis can name without running the file.
 *
 * Only two forms have a static identity: a bare identifier, which names the
 * class or the `createToken` binding the token is, and a direct
 * `createToken(...)` call from `@aponiajs/common`. A token built any other way —
 * from `Symbol(...)`, from a namespace member, from a factory — has nothing to
 * reproduce in the generated source, so the analysis reports it as unreadable
 * instead of guessing at it.
 */
export interface AnalyzedToken {
  /** The token expression exactly as written, ready to be emitted into source. */
  readonly expression: string;
  readonly kind: AnalyzedTokenKind;
}

/**
 * One entry of a module's `imports`, `controllers`, `providers`, or `exports`.
 *
 * A reported entry is never dropped: `expression` keeps the text the decorator
 * wrote and `unreadable` names what could not be read.
 */
export interface AnalyzedModuleEntry {
  /** The expression exactly as the decorator wrote it. */
  readonly expression: string;
  /** Why the entry cannot be lowered, or `undefined` when it can. */
  readonly unreadable: string | undefined;
}

/** A constructor parameter an `@Inject()` decorator names a token for. */
export interface AnalyzedInjectedDependency {
  /** Position of the parameter in the constructor's declaration. */
  readonly index: number;
  readonly source: "inject";
  /** The token `@Inject()` names, which takes precedence over the declared type. */
  readonly token: AnalyzedToken;
}

/** A constructor parameter with no `@Inject()`, resolved by its declared type. */
export interface AnalyzedTypedDependency {
  readonly index: number;
  readonly source: "type";
  /** The parameter's type exactly as declared, which the runtime reads from `design:paramtypes`. */
  readonly type: string;
}

/** A constructor parameter the analysis could not reduce to a token. */
export interface AnalyzedUnreadableDependency {
  readonly index: number;
  readonly source: "unreadable";
  /** Why the parameter could not be read. */
  readonly reason: string;
}

/**
 * One constructor parameter and how the container resolves it.
 *
 * `inject` wins over `type` when both are declared, because the runtime resolves
 * an explicit token before it falls back to the reflected design type.
 */
export type AnalyzedConstructorDependency =
  | AnalyzedInjectedDependency
  | AnalyzedTypedDependency
  | AnalyzedUnreadableDependency;

/** A class a source file decorates with `@Module()`. */
export interface AnalyzedModule {
  /** The class name exactly as declared, or `""` for an anonymous class. */
  readonly className: string;
  /** The collections the decorator declares, in declaration order. */
  readonly imports: readonly AnalyzedModuleEntry[];
  readonly controllers: readonly AnalyzedModuleEntry[];
  readonly providers: readonly AnalyzedModuleEntry[];
  readonly exports: readonly AnalyzedModuleEntry[];
  /** The constructor's dependencies, ordered by parameter index. */
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  /**
   * Why the collections the decorator declares cannot be lowered, in the order
   * the analysis found them; empty when every one of them was read.
   *
   * It carries the reason a collection that is not an array literal caused and
   * the reason each unreadable element carries, so a consumer that only lowers
   * the collections never has to inspect the entries and never mistakes an
   * omission for a module that declares nothing.
   */
  readonly collectionUnreadable: readonly string[];
  /**
   * Every reason this declaration cannot be lowered into a module descriptor, in
   * the order the analysis found them.
   *
   * It repeats the reason each unreadable entry and dependency carries, so a
   * consumer that only checks this list never misses one. An empty list means
   * the whole declaration was read.
   */
  readonly unreadable: readonly string[];
}

/**
 * A class a source file decorates with `@Controller()`.
 *
 * The route analysis reads the same class's path and routes. What only a module
 * declaration needs is how the container builds it, so this record carries the
 * constructor dependencies and nothing else.
 */
export interface AnalyzedControllerDeclaration {
  /** The class name exactly as declared, or `""` for an anonymous class. */
  readonly className: string;
  /** The constructor's dependencies, ordered by parameter index. */
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  /** Every reason this declaration cannot be lowered, or empty when it can. */
  readonly unreadable: readonly string[];
}

/** A class a source file decorates with `@Injectable()`. */
export interface AnalyzedInjectable {
  /** The class name exactly as declared, or `""` for an anonymous class. */
  readonly className: string;
  /** The constructor's dependencies, ordered by parameter index. */
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  /** Every reason this declaration cannot be lowered, or empty when it can. */
  readonly unreadable: readonly string[];
}

/**
 * The values a WebSocket parameter decorator can bind.
 *
 * Mirrors `WebSocketParameterKind` in `@aponiajs/common`
 * (`packages/common/src/websockets/websocket-gateway.types.ts`). The CLI is
 * independent of the runtime packages, so the union is declared locally and must
 * be kept in step with that source by hand.
 */
export type AnalyzedWebSocketParameterKind = "message-body" | "connected-socket";

/**
 * One gateway method parameter a WebSocket decorator binds.
 *
 * Only decorated parameters appear. A parameter no such decorator names is left
 * out, which is exactly what the handler receives from the runtime: an argument
 * the platform never passes is `undefined`.
 */
export interface AnalyzedGatewayParameter {
  /** Position of the parameter in the method's declaration. */
  readonly index: number;
  /** The value the decorator binds. */
  readonly kind: AnalyzedWebSocketParameterKind;
  /** The named property of the message data, or `undefined` when the whole value is bound. */
  readonly property: string | undefined;
}

/**
 * One message handler a `@SubscribeMessage()` decorator declares.
 *
 * A handler appears only when the analysis read it whole — its event, its
 * property key, and every parameter a decorator binds. A handler it could not
 * read is left out, and its reason is reported on the gateway's `unreadable`
 * list, which is what disqualifies the gateway: a plan that dropped one handler
 * would answer for the application with a silent gap instead of a rejection.
 */
export interface AnalyzedGatewayHandler {
  /** The event the handler subscribes to, exactly as the decorator wrote it. */
  readonly event: string;
  /** The method name the handler is looked up by. */
  readonly propertyKey: string;
  /** The handler's WebSocket parameter bindings, ordered by parameter index. */
  readonly parameters: readonly AnalyzedGatewayParameter[];
}

/** A class a source file decorates with `@WebSocketGateway()`. */
export interface AnalyzedGateway {
  /** The class name exactly as declared, or `""` for an anonymous class. */
  readonly className: string;
  /**
   * The gateway's path, defaulted to `/ws` exactly as `@WebSocketGateway()`
   * does, or `undefined` when the decorator declares a path the analysis cannot
   * read — see `unreadable`.
   */
  readonly path: string | undefined;
  /** The constructor's dependencies, ordered by parameter index. */
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  /** The message handlers the class declares, in declaration order. */
  readonly handlers: readonly AnalyzedGatewayHandler[];
  /** The instance properties `@WebSocketServer()` marks, in declaration order. */
  readonly serverProperties: readonly string[];
  /** Every reason this declaration cannot be lowered, or empty when it can. */
  readonly unreadable: readonly string[];
}

/**
 * A class a source file decorates with `@Validation(validator)`.
 *
 * The runtime resolves such a class to the validator it was declared with while
 * the routes naming it mount, by reading the decorator's metadata. The analysis
 * reads the same decorator statically so a generated route can state the
 * validator itself and nothing has to be read at startup.
 */
export interface AnalyzedValidationModel {
  /** The class name exactly as declared, or `""` for an anonymous class. */
  readonly className: string;
  /**
   * The validator the decorator declares, ready to be emitted into generated
   * source, or `undefined` when it could not be read — see `unreadable`.
   *
   * The model file's own module-scope `const` declarations are folded into the
   * expression, because a generated module cannot name a binding the file does
   * not export.
   */
  readonly validator: string | undefined;
  /** Every reason this model's validator cannot be lowered, or empty when it can. */
  readonly unreadable: readonly string[];
}

/** Everything one source file declares, in declaration order. */
export interface AnalyzedModuleDescriptors {
  readonly modules: readonly AnalyzedModule[];
  readonly controllers: readonly AnalyzedControllerDeclaration[];
  readonly injectables: readonly AnalyzedInjectable[];
  readonly gateways: readonly AnalyzedGateway[];
  readonly validationModels: readonly AnalyzedValidationModel[];
}
