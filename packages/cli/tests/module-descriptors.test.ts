import { describe, expect, test } from "bun:test";
import { analyzeModuleDescriptors } from "../src/index.ts";

describe("analyzeModuleDescriptors", () => {
  test("reads a module's imports, controllers, providers, and exports in declaration order", () => {
    const source = `import { Module } from "@aponiajs/common";
import { AuditModule } from "./audit.module.ts";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

@Module({
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`;

    expect(analyzeModuleDescriptors(source, "users.module.ts")).toStrictEqual({
      modules: [
        {
          className: "UsersModule",
          imports: [{ expression: "AuditModule", unreadable: undefined }],
          controllers: [{ expression: "UsersController", unreadable: undefined }],
          providers: [{ expression: "UsersService", unreadable: undefined }],
          exports: [{ expression: "UsersService", unreadable: undefined }],
          dependencies: [],
          collectionUnreadable: [],
          unreadable: [],
        },
      ],
      controllers: [],
      injectables: [],
      gateways: [],
    });
  });

  test("reads a module that declares none of its collections as an empty module, not an unreadable one", () => {
    const source = `import { Module } from "@aponiajs/common";

@Module({})
export class EmptyModule {}
`;

    expect(analyzeModuleDescriptors(source, "empty.module.ts").modules).toStrictEqual([
      {
        className: "EmptyModule",
        imports: [],
        controllers: [],
        providers: [],
        exports: [],
        dependencies: [],
        collectionUnreadable: [],
        unreadable: [],
      },
    ]);
  });

  test("reads a provider descriptor call and a string-keyed collection as written", () => {
    const source = `import { Module, createToken, provideValue } from "@aponiajs/common";

const ANSWER = createToken<number>("ANSWER");

@Module({
  "providers": [provideValue(ANSWER, 42)],
})
export class ValuesModule {}
`;

    expect(
      analyzeModuleDescriptors(source, "values.module.ts").modules[0]?.providers,
    ).toStrictEqual([{ expression: "provideValue(ANSWER, 42)", unreadable: undefined }]);
  });

  test("reads an @Injectable class with its constructor dependencies", () => {
    const source = `import { Injectable } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Injectable()
export class AuditService {
  constructor(private readonly usersService: UsersService, readonly label: string) {}
}
`;

    expect(analyzeModuleDescriptors(source, "audit.service.ts").injectables).toStrictEqual([
      {
        className: "AuditService",
        dependencies: [
          { index: 0, source: "type", type: "UsersService" },
          { index: 1, source: "type", type: "string" },
        ],
        unreadable: [],
      },
    ]);
  });

  test("reads a gateway's declared path and defaults an omitted one to /ws", () => {
    const source = `import { WebSocketGateway } from "@aponiajs/common";

@WebSocketGateway()
export class DefaultGateway {}

@WebSocketGateway("chat")
export class ChatGateway {}

@WebSocketGateway({ path: "events" })
export class EventsGateway {}

@WebSocketGateway({})
export class EmptyOptionsGateway {}
`;

    expect(
      analyzeModuleDescriptors(source, "gateways.ts").gateways.map((gateway) => [
        gateway.className,
        gateway.path,
        gateway.unreadable,
      ]),
    ).toStrictEqual([
      ["DefaultGateway", "/ws", []],
      ["ChatGateway", "chat", []],
      ["EventsGateway", "events", []],
      ["EmptyOptionsGateway", "/ws", []],
    ]);
  });

  test("reads @Inject() tokens by parameter index and declared types for the rest", () => {
    const source = `import { Inject, Injectable, createToken } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

const AUDIT = createToken<Audit>("AUDIT");
const CONFIG = createToken<Config>("CONFIG");

@Injectable()
export class AuditService {
  constructor(
    private readonly usersService: UsersService,
    @Inject(AUDIT)
    private readonly audit: Audit,
    @Inject(createToken<Clock>("CLOCK"))
    readonly clock: Clock,
    @Inject(CONFIG)
    readonly config: Config,
  ) {}
}
`;

    expect(
      analyzeModuleDescriptors(source, "audit.service.ts").injectables[0]?.dependencies,
    ).toStrictEqual([
      { index: 0, source: "type", type: "UsersService" },
      { index: 1, source: "inject", token: { expression: "AUDIT", kind: "reference" } },
      {
        index: 2,
        source: "inject",
        token: { expression: 'createToken<Clock>("CLOCK")', kind: "injection-token" },
      },
      { index: 3, source: "inject", token: { expression: "CONFIG", kind: "reference" } },
    ]);
  });

  test("reads two decorated classes in one file in declaration order", () => {
    const source = `import { Injectable, Module } from "@aponiajs/common";

@Injectable()
export class FirstService {}

@Module({ providers: [FirstService] })
export class SecondModule {}

@Injectable()
export class ThirdService {}
`;

    const analyzed = analyzeModuleDescriptors(source, "declarations.ts");

    expect(analyzed.modules.map((module) => module.className)).toStrictEqual(["SecondModule"]);
    expect(analyzed.injectables.map((injectable) => injectable.className)).toStrictEqual([
      "FirstService",
      "ThirdService",
    ]);
  });

  test("recognizes decorators imported under an alias and through a namespace", () => {
    const source = `import { Module as Declare, Injectable as Service } from "@aponiajs/common";
import * as aponia from "@aponiajs/common";

@Declare({ exports: [aponia.createToken("NAMED")] })
export class AliasedModule {}

@aponia.Module({ controllers: [] })
export class NamespacedModule {}

@Service()
export class AliasedService {}

@aponia.WebSocketGateway("ns")
export class NamespacedGateway {}
`;

    const analyzed = analyzeModuleDescriptors(source, "aliases.ts");

    expect(analyzed.modules.map((module) => module.className)).toStrictEqual([
      "AliasedModule",
      "NamespacedModule",
    ]);
    expect(analyzed.injectables.map((injectable) => injectable.className)).toStrictEqual([
      "AliasedService",
    ]);
    expect(analyzed.gateways.map((gateway) => [gateway.className, gateway.path])).toStrictEqual([
      ["NamespacedGateway", "ns"],
    ]);
  });

  test("ignores a same-named decorator imported from somewhere else", () => {
    const source = `import { Module } from "./local-decorators.ts";
import { Injectable } from "@aponiajs/common";

@Module({ providers: [NotAService] })
class NotAModule {}

@Module()
class AlsoNotAModule {}

@Injectable()
class IsAService {}

const localModule = { Module };
@localModule.Module()
class NotRecognizedEither {}

(function Module() {})();
`;

    const analyzed = analyzeModuleDescriptors(source, "impostors.ts");

    expect(analyzed.modules).toStrictEqual([]);
    expect(analyzed.injectables.map((injectable) => injectable.className)).toStrictEqual([
      "IsAService",
    ]);
  });

  test("ignores a decorator factory that is never called", () => {
    const source = `import { Injectable, Module, WebSocketGateway } from "@aponiajs/common";

@Module
class UncalledModule {}

@Injectable
class UncalledService {}

@WebSocketGateway
class UncalledGateway {}
`;

    expect(analyzeModuleDescriptors(source, "uncalled.ts")).toStrictEqual({
      modules: [],
      controllers: [],
      injectables: [],
      gateways: [],
    });
  });

  test("returns no declarations for a file that never imports @aponiajs/common", () => {
    const source = `import { Module } from "./local-decorators.ts";

@Module({ providers: [] })
export class Unrelated {}
`;

    expect(analyzeModuleDescriptors(source, "unrelated.ts")).toStrictEqual({
      modules: [],
      controllers: [],
      injectables: [],
      gateways: [],
    });
  });

  test("reports a module whose options are built from a variable instead of dropping it", () => {
    const source = `import { Module } from "@aponiajs/common";

const shared = { controllers: [] };

@Module(shared)
export class SharedModule {}

@Module(buildOptions())
export class BuiltModule {}
`;

    const analyzed = analyzeModuleDescriptors(source, "shared.module.ts");

    expect(analyzed.modules.map((module) => module.className)).toStrictEqual([
      "SharedModule",
      "BuiltModule",
    ]);
    expect(analyzed.modules[0]?.imports).toStrictEqual([]);
    expect(analyzed.modules[0]?.unreadable).toStrictEqual([
      "@Module in shared.module.ts declares options this analysis cannot read statically; write the object literal inline.",
    ]);
    expect(analyzed.modules[1]?.unreadable).toStrictEqual(analyzed.modules[0]?.unreadable);
  });

  test("reports a collection that is not an array literal and a spread that may declare one", () => {
    const source = `import { Module } from "@aponiajs/common";

const providers = [UsersService];

@Module({ providers: declaredElsewhere })
export class ReferencedModule {}

@Module({ providers })
export class ShorthandModule {}

@Module({ ...base, controllers: [UsersController] })
export class SpreadModule {}
`;

    const analyzed = analyzeModuleDescriptors(source, "unreadable.module.ts");

    expect(analyzed.modules.map((module) => module.unreadable)).toStrictEqual([
      [
        '@Module in unreadable.module.ts must declare "providers" as an array literal to be read statically.',
      ],
      ['@Module in unreadable.module.ts declares "providers" outside its options literal.'],
      [
        "@Module in unreadable.module.ts spreads its options, which may declare collections this analysis cannot read.",
      ],
    ]);
  });

  test("reports a spread element, a computed expression, and an unreadable token in a collection", () => {
    const source = `import { Module } from "@aponiajs/common";

const extra = [];

@Module({
  imports: [UsersModule, ...extra],
  providers: [condition ? FirstService : SecondService],
  exports: [Symbol("LEGACY")],
})
export class MixedModule {}
`;

    expect(analyzeModuleDescriptors(source, "mixed.module.ts").modules[0]).toStrictEqual({
      className: "MixedModule",
      imports: [
        { expression: "UsersModule", unreadable: undefined },
        {
          expression: "...extra",
          unreadable:
            "@Module in mixed.module.ts spreads a collection element, which this analysis cannot read.",
        },
      ],
      controllers: [],
      providers: [
        {
          expression: "condition ? FirstService : SecondService",
          unreadable:
            "@Module in mixed.module.ts declares an expression this analysis cannot read statically.",
        },
      ],
      exports: [
        {
          expression: 'Symbol("LEGACY")',
          unreadable:
            "@Module in mixed.module.ts names a token this analysis cannot read statically; use a class reference or createToken(...).",
        },
      ],
      dependencies: [],
      collectionUnreadable: [
        "@Module in mixed.module.ts spreads a collection element, which this analysis cannot read.",
        "@Module in mixed.module.ts declares an expression this analysis cannot read statically.",
        "@Module in mixed.module.ts names a token this analysis cannot read statically; use a class reference or createToken(...).",
      ],
      unreadable: [
        "@Module in mixed.module.ts spreads a collection element, which this analysis cannot read.",
        "@Module in mixed.module.ts declares an expression this analysis cannot read statically.",
        "@Module in mixed.module.ts names a token this analysis cannot read statically; use a class reference or createToken(...).",
      ],
    });
  });

  test("ignores an option the decorator does not read and reports one whose name it cannot name", () => {
    const source = `import { Module } from "@aponiajs/common";

const key = "providers";

@Module({ provider: [UsersService], imports: [UsersModule] })
export class MisspelledModule {}

@Module({ [key]: [UsersService] })
export class ComputedModule {}

@Module({ providers() {} })
export class MethodModule {}
`;

    expect(analyzeModuleDescriptors(source, "misspelled.module.ts").modules).toStrictEqual([
      {
        className: "MisspelledModule",
        imports: [{ expression: "UsersModule", unreadable: undefined }],
        controllers: [],
        providers: [],
        exports: [],
        dependencies: [],
        collectionUnreadable: [],
        unreadable: [],
      },
      {
        className: "ComputedModule",
        imports: [],
        controllers: [],
        providers: [],
        exports: [],
        dependencies: [],
        collectionUnreadable: [
          "@Module in misspelled.module.ts declares an option this analysis cannot read statically.",
        ],
        unreadable: [
          "@Module in misspelled.module.ts declares an option this analysis cannot read statically.",
        ],
      },
      {
        className: "MethodModule",
        imports: [],
        controllers: [],
        providers: [],
        exports: [],
        dependencies: [],
        collectionUnreadable: [
          "@Module in misspelled.module.ts declares an option this analysis cannot read statically.",
        ],
        unreadable: [
          "@Module in misspelled.module.ts declares an option this analysis cannot read statically.",
        ],
      },
    ]);
  });

  test("reports a token that is a namespace member, a factory call, or an @Inject() argument the analysis cannot read", () => {
    const source = `import { Inject, Injectable, Module } from "@aponiajs/common";
import * as shared from "./shared.ts";

@Module({ exports: [shared.UsersService] })
export class NamespacedModule {}

@Injectable()
export class FirstService {
  constructor(@Inject(shared.AUDIT) readonly audit: Audit) {}
}

@Injectable()
export class SecondService {
  constructor(@Inject(buildToken()) readonly token: Token) {}
}
`;

    const analyzed = analyzeModuleDescriptors(source, "tokens.ts");

    expect(analyzed.modules[0]?.unreadable).toStrictEqual([
      "@Module in tokens.ts names a token this analysis cannot read statically; use a class reference or createToken(...).",
    ]);
    expect(analyzed.modules[0]?.exports).toStrictEqual([
      {
        expression: "shared.UsersService",
        unreadable:
          "@Module in tokens.ts names a token this analysis cannot read statically; use a class reference or createToken(...).",
      },
    ]);
    const unreadableReason =
      "@Inject in tokens.ts names a token this analysis cannot read statically; use a class reference or createToken(...).";
    expect(analyzed.injectables[0]?.dependencies).toStrictEqual([
      { index: 0, source: "unreadable", reason: unreadableReason },
    ]);
    expect(analyzed.injectables[0]?.unreadable).toStrictEqual([unreadableReason]);
    expect(analyzed.injectables[1]?.dependencies).toStrictEqual([
      { index: 0, source: "unreadable", reason: unreadableReason },
    ]);
  });

  test("reports a gateway whose path is a variable or read from an object", () => {
    const source = `import { WebSocketGateway } from "@aponiajs/common";

@WebSocketGateway(path)
export class VariableGateway {}

@WebSocketGateway({ path })
export class ShorthandPathGateway {}

@WebSocketGateway({ ...options })
export class SpreadPathGateway {}

@WebSocketGateway({ path: 1 })
export class NumericPathGateway {}

@WebSocketGateway(options)
export class OptionsGateway {}
`;

    expect(
      analyzeModuleDescriptors(source, "paths.ts").gateways.map((gateway) => [
        gateway.className,
        gateway.path,
        gateway.unreadable,
      ]),
    ).toStrictEqual([
      [
        "VariableGateway",
        undefined,
        ["@WebSocketGateway in paths.ts declares a path this analysis cannot read statically."],
      ],
      [
        "ShorthandPathGateway",
        undefined,
        ["@WebSocketGateway in paths.ts declares a path this analysis cannot read statically."],
      ],
      [
        "SpreadPathGateway",
        undefined,
        ["@WebSocketGateway in paths.ts declares a path this analysis cannot read statically."],
      ],
      [
        "NumericPathGateway",
        undefined,
        ["@WebSocketGateway in paths.ts declares a path this analysis cannot read statically."],
      ],
      [
        "OptionsGateway",
        undefined,
        ["@WebSocketGateway in paths.ts declares a path this analysis cannot read statically."],
      ],
    ]);
  });

  test("reports a class that declares no constructor but extends one this file does not read", () => {
    const source = `import { Injectable, Module } from "@aponiajs/common";
import { BaseService } from "./base.service.ts";

@Injectable()
export class DerivedService extends BaseService {}

@Module({ providers: [DerivedService], controllers: [UsersController] })
export class DerivedModule extends BaseModule {}

@Injectable()
export class StandaloneService {}

@Injectable()
export default class extends BaseService {}
`;

    const analyzed = analyzeModuleDescriptors(source, "derived.ts");

    expect(analyzed.injectables[0]).toStrictEqual({
      className: "DerivedService",
      dependencies: [],
      unreadable: [
        "The class DerivedService in derived.ts declares no constructor but extends BaseService, so its dependencies come from a class this analysis does not read.",
      ],
    });
    expect(analyzed.injectables[1]).toStrictEqual({
      className: "StandaloneService",
      dependencies: [],
      unreadable: [],
    });
    expect(analyzed.modules[0]?.controllers).toStrictEqual([
      { expression: "UsersController", unreadable: undefined },
    ]);
    expect(analyzed.modules[0]?.unreadable).toStrictEqual([
      "The class DerivedModule in derived.ts declares no constructor but extends BaseModule, so its dependencies come from a class this analysis does not read.",
    ]);
    expect(analyzed.injectables[2]).toStrictEqual({
      className: "",
      dependencies: [],
      unreadable: [
        "The class in derived.ts declares no constructor but extends BaseService, so its dependencies come from a class this analysis does not read.",
      ],
    });
  });

  test("reports a constructor parameter that declares neither a type nor an @Inject() token", () => {
    const source = `import { Injectable } from "@aponiajs/common";

@Injectable()
export class LooseService {
  constructor(undocumented) {}
}
`;

    expect(analyzeModuleDescriptors(source, "loose.service.ts").injectables[0]).toStrictEqual({
      className: "LooseService",
      dependencies: [
        {
          index: 0,
          source: "unreadable",
          reason:
            "The constructor parameter at index 0 in loose.service.ts declares no type and no @Inject() token.",
        },
      ],
      unreadable: [
        "The constructor parameter at index 0 in loose.service.ts declares no type and no @Inject() token.",
      ],
    });
  });

  test("reads the implementation of an overloaded constructor and the winning duplicate decorator", () => {
    const source = `import { Injectable, Module } from "@aponiajs/common";

@Injectable()
export class OverloadedService {
  constructor(label: string);
  constructor(readonly label: string, readonly count: number) {}
}

@Module({ controllers: [UsersController] })
@Module({ providers: [UsersService] })
export class TwiceModule {}

const factory = (decorator: unknown) => decorator;

@factory(Injectable)()
export class IndirectedService {}
`;

    const analyzed = analyzeModuleDescriptors(source, "overloaded.ts");

    expect(
      analyzed.injectables.find((entry) => entry.className === "OverloadedService")?.dependencies,
    ).toStrictEqual([
      { index: 0, source: "type", type: "string" },
      { index: 1, source: "type", type: "number" },
    ]);
    expect(analyzed.modules.map((module) => module.className)).toStrictEqual(["TwiceModule"]);
    // Decorators are applied bottom-up, so the topmost @Module() call is the one
    // whose metadata the runtime records.
    expect(analyzed.modules[0]?.controllers).toStrictEqual([
      { expression: "UsersController", unreadable: undefined },
    ]);
    expect(analyzed.modules[0]?.providers).toStrictEqual([]);
    expect(analyzed.injectables.some((entry) => entry.className === "IndirectedService")).toBe(
      false,
    );
  });

  test("returns frozen data at every level", () => {
    const source = `import { Inject, Injectable, Module, createToken, WebSocketGateway } from "@aponiajs/common";

const AUDIT = createToken<Audit>("AUDIT");

@Module({ providers: [UsersService], exports: [AUDIT], unrecognized: 1 })
export class UsersModule {
  constructor(@Inject(AUDIT) readonly audit: Audit) {}
}

@Injectable()
export class UsersService extends BaseService {}

@WebSocketGateway(config)
export class ChatGateway {}
`;

    const analyzed = analyzeModuleDescriptors(source, "frozen.ts");

    expect(analyzed.modules.length).toBe(1);
    expect(analyzed.injectables.length).toBe(1);
    expect(analyzed.gateways.length).toBe(1);
    expect(isDeeplyFrozen(analyzed)).toBe(true);
    expect(
      isDeeplyFrozen(analyzeModuleDescriptors(`export class Nothing {}\n`, "nothing.ts")),
    ).toBe(true);
  });

  test("returns the same declarations for the same source every time", () => {
    const source = `import { Injectable, Module } from "@aponiajs/common";

@Module({ providers: [UsersService], controllers: [UsersController] })
export class UsersModule {}

@Injectable()
export class UsersService {}
`;

    const first = analyzeModuleDescriptors(source, "users.module.ts");
    const second = analyzeModuleDescriptors(source, "users.module.ts");

    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
  });

  test.each([
    {
      label: "@Module() without an options object",
      source: `import { Module } from "@aponiajs/common";
@Module()
export class UsersModule {}
`,
      message: "@Module in broken.ts must declare exactly one options object.",
    },
    {
      label: "@Module() with two options objects",
      source: `import { Module } from "@aponiajs/common";
@Module({}, {})
export class UsersModule {}
`,
      message: "@Module in broken.ts must declare exactly one options object.",
    },
    {
      label: "@Injectable() with arguments",
      source: `import { Injectable } from "@aponiajs/common";
@Injectable("scope")
export class UsersService {}
`,
      message: "@Injectable in broken.ts must not declare arguments.",
    },
    {
      label: "@Inject() without a token",
      source: `import { Injectable, Inject } from "@aponiajs/common";
@Injectable()
export class UsersService {
  constructor(@Inject() readonly audit: Audit) {}
}
`,
      message: "@Inject in broken.ts must declare exactly one token.",
    },
    {
      label: "@Inject() with two tokens",
      source: `import { Injectable, Inject } from "@aponiajs/common";
@Injectable()
export class UsersService {
  constructor(@Inject(A, B) readonly audit: Audit) {}
}
`,
      message: "@Inject in broken.ts must declare exactly one token.",
    },
    {
      label: "@WebSocketGateway() with two arguments",
      source: `import { WebSocketGateway } from "@aponiajs/common";
@WebSocketGateway("chat", "events")
export class ChatGateway {}
`,
      message: "@WebSocketGateway in broken.ts must declare at most one path or options object.",
    },
    {
      label: "@WebSocketGateway() with an empty path",
      source: `import { WebSocketGateway } from "@aponiajs/common";
@WebSocketGateway("")
export class ChatGateway {}
`,
      message: "@WebSocketGateway in broken.ts must declare a non-empty path.",
    },
    {
      label: "@WebSocketGateway() with an empty options path",
      source: `import { WebSocketGateway } from "@aponiajs/common";
@WebSocketGateway({ path: "" })
export class ChatGateway {}
`,
      message: "@WebSocketGateway in broken.ts must declare a non-empty path.",
    },
  ])("throws a plain Error for $label", ({ source, message }) => {
    expect(() => analyzeModuleDescriptors(source, "broken.ts")).toThrow(Error);
    expect(() => analyzeModuleDescriptors(source, "broken.ts")).toThrow(message);
  });
});

function isDeeplyFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (!Object.isFrozen(value)) {
    return false;
  }

  return Object.values(value).every((entry) => isDeeplyFrozen(entry));
}
