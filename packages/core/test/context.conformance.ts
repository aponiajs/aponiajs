import {
  Scope,
  createToken,
  defineModule,
  provideValue,
  type ProviderScope,
} from "@aponiajs/common";
import {
  CONTEXT,
  ContextIdFactory,
  INQUIRER,
  ModuleRef,
  REQUEST,
  createContainer,
  type ContextId,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("Scope exposes Nest's numeric values", () => {
  expect(Scope.DEFAULT).toBe(0);
  expect(Scope.TRANSIENT).toBe(1);
  expect(Scope.REQUEST).toBe(2);
  const scope: ProviderScope = Scope.REQUEST;
  expect(scope).toBe(2);
});

test("ModuleRef accepts the strict and each options", () => {
  const token = createToken<string>("value");
  const feature = defineModule({
    id: "feature",
    providers: [provideValue(token, "value")],
    exports: [token],
  });
  const root = defineModule({ id: "root", imports: [feature] });
  const container = createContainer(root);
  const reference = container.resolveModuleProvider(root, ModuleRef) as ModuleRef;

  expect(reference.get(token)).toBe("value");
  expect(reference.get(token, { strict: false })).toBe("value");
  expect(reference.get(token, { each: true })).toBeDefined();
});

test("the context tokens and factory are exported", () => {
  const contextId: ContextId = ContextIdFactory.create();
  expect(contextId.id).toBeDefined();
  expect(REQUEST).toBeDefined();
  expect(CONTEXT).toBeDefined();
  expect(INQUIRER).toBeDefined();
});
