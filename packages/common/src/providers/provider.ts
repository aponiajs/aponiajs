import type { ClassToken, Constructor, Token, TokenValues } from "../tokens/token.types.ts";
import type {
  AliasProvider,
  ClassProvider,
  FactoryProvider,
  ValueProvider,
} from "./provider.types.ts";

export function provideValue<T>(provide: Token<T>, useValue: T): ValueProvider<T> {
  return Object.freeze({
    kind: "value",
    provide,
    useValue,
  });
}

export function provideFactory<T, const TDependencies extends readonly Token<unknown>[]>(
  provide: Token<T>,
  inject: TDependencies,
  useFactory: (...dependencies: TokenValues<TDependencies>) => T,
): FactoryProvider<T, TDependencies> {
  return Object.freeze({
    kind: "factory",
    provide,
    inject,
    useFactory,
  });
}

export function provideClass<T, const TDependencies extends readonly Token<unknown>[]>(
  useClass: ClassToken<T> & Constructor<T, TokenValues<TDependencies>>,
  inject: TDependencies,
): ClassProvider<T, TDependencies> {
  return Object.freeze({
    kind: "class",
    provide: useClass,
    inject,
    useClass,
  });
}

export function provideAlias<T>(provide: Token<T>, useExisting: Token<T>): AliasProvider<T> {
  return Object.freeze({
    kind: "alias",
    provide,
    useExisting,
  });
}
