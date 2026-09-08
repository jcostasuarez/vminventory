declare module 'node:test' {
  type TestCallback = () => void | Promise<void>;

  export function describe(name: string, callback: TestCallback): void;
  export function it(name: string, callback: TestCallback): void;
  export function test(name: string, callback: TestCallback): void;
  export function beforeEach(callback: TestCallback): void;
  export function afterEach(callback: TestCallback): void;
}

declare module 'node:assert/strict' {
  interface AssertFunction {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    doesNotThrow(callback: () => unknown, message?: string): void;
  }

  const assert: AssertFunction;
  export default assert;
}
