/** Calculator + unit/currency-free conversions via mathjs, locked down so user input can't run code. */
import { tool } from "ai";
import { all, create } from "mathjs";
import { z } from "zod";

const math = create(all);
const evaluate = math.evaluate.bind(math);
// Per the mathjs security guide: disable anything that can reach into the runtime.
math.import(
  {
    import: () => { throw new Error("disabled"); },
    createUnit: () => { throw new Error("disabled"); },
    reviver: () => { throw new Error("disabled"); },
    evaluate: () => { throw new Error("disabled"); },
    parse: () => { throw new Error("disabled"); },
    simplify: () => { throw new Error("disabled"); },
    derivative: () => { throw new Error("disabled"); },
    resolve: () => { throw new Error("disabled"); },
  },
  { override: true },
);

export function calculate(expression: string): string {
  const result = evaluate(expression);
  return math.format(result, { precision: 12 });
}

export const calcTools = {
  calculate: tool({
    description:
      "Do exact math and unit conversions. Examples: '(1299 * 0.0825) + 1299', '5 miles to km', '72 degF to degC', '15% of 240' (write as '0.15 * 240'), 'sqrt(144)'. " +
      "Use this instead of doing arithmetic in your head. It does NOT know live currency rates.",
    inputSchema: z.object({ expression: z.string().max(300) }),
    execute: async ({ expression }) => {
      try {
        return { expression, result: calculate(expression) };
      } catch (e) {
        return { error: `Couldn't evaluate that: ${(e as Error).message}` };
      }
    },
  }),
};
