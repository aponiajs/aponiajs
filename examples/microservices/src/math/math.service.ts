export class MathService {
  accumulated = 0;

  double(value: number): number {
    return value * 2;
  }

  sum(a: number, b: number): number {
    return a + b;
  }

  record(value: number): void {
    this.accumulated += value;
  }
}

export interface SumInput {
  readonly a: number;
  readonly b: number;
}
