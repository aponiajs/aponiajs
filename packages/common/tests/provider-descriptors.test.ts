import { describe, expect, test } from "bun:test";
import {
  createToken,
  defineModule,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
  type ModuleDefinition,
} from "../src/index.ts";

describe("@aponiajs/common provider descriptors", () => {
  test("returns frozen descriptors for every provider kind", () => {
    const value = createToken<number>("value");
    const alias = createToken<number>("alias");
    class Service {}

    const valueProvider = provideValue(value, 1);
    const factoryProvider = provideFactory(value, [alias] as const, (item) => item);
    const classProvider = provideClass(Service, [] as const);
    const aliasProvider = provideAlias(alias, value);

    expect(Object.isFrozen(valueProvider)).toBe(true);
    expect(Object.isFrozen(factoryProvider)).toBe(true);
    expect(Object.isFrozen(classProvider)).toBe(true);
    expect(Object.isFrozen(aliasProvider)).toBe(true);
    expect(valueProvider.kind).toBe("value");
    expect(valueProvider.provide).toBe(value);
    expect(valueProvider.useValue).toBe(1);
    expect(factoryProvider.kind).toBe("factory");
    expect(factoryProvider.inject).toEqual([alias]);
    expect(classProvider.kind).toBe("class");
    expect(classProvider.provide).toBe(Service);
    expect(classProvider.useClass).toBe(Service);
    expect(aliasProvider.kind).toBe("alias");
    expect(aliasProvider.useExisting).toBe(value);
  });

  test("binds a class provider to a separate token when one is given", () => {
    const repository = createToken<Port>("repository");
    class Port {
      read(): string {
        return "port";
      }
    }
    class SqlRepository implements Port {
      read(): string {
        return "sql";
      }
    }

    const boundProvider = provideClass(repository, SqlRepository, [] as const);
    const ownProvider = provideClass(SqlRepository, [] as const);

    expect(Object.isFrozen(boundProvider)).toBe(true);
    expect(boundProvider.kind).toBe("class");
    expect(boundProvider.provide).toBe(repository);
    expect(boundProvider.useClass).toBe(SqlRepository);
    expect(boundProvider.inject).toEqual([]);
    expect(ownProvider.provide).toBe(SqlRepository);
    expect(boundProvider).not.toEqual(ownProvider);
  });

  test("copies caller-owned module collections before freezing them", () => {
    const value = createToken<number>("value");
    const providers = [provideValue(value, 1)];
    const imports: ModuleDefinition[] = [];
    const module = defineModule({ id: "copied", imports, providers });

    providers.push(provideValue(createToken<number>("late-value"), 2));
    imports.push(defineModule({ id: "late-import" }));

    expect(providers).toHaveLength(2);
    expect(imports).toHaveLength(1);
    expect(module.providers).toEqual([provideValue(value, 1)]);
    expect(module.imports).toEqual([]);
    expect(Object.isFrozen(module.providers)).toBe(true);
    expect(Object.isFrozen(module.imports)).toBe(true);
    expect(Object.isFrozen(module.controllers)).toBe(true);
    expect(Object.isFrozen(module.exports)).toBe(true);
  });
});
