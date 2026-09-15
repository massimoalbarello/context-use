import type { Tool } from '@modelcontextprotocol/client';
import { Type } from 'typebox';
import { z } from 'zod';

// OpenClaw's ChatGPT transport lets the provider require every property. Give
// optional inputs an explicit omission value without changing the MCP contract.
function optionalInput(schema: z.ZodOptional): z.ZodType {
  const original = schema.unwrap() as z.ZodType;
  const value = modelInput(original);
  const nullable = original.safeParse(null).success;
  const input = nullable ? z.strictObject({ value }) : value;
  const description = schema.description ?? original.description ?? '';
  return input
    .nullable()
    .optional()
    .transform((input) => {
      if (input === null || input === undefined) {
        return undefined;
      }
      return nullable ? (input as { value: unknown }).value : input;
    })
    .describe(
      nullable
        ? `Use null or omit this field to leave it unspecified. To supply a value, use {"value": ...}; {"value": null} explicitly supplies null (for example, to clear an existing value). The following server guidance applies to the wrapped value: ${description}`
        : `${description} Use null or omit this field to leave it unspecified.`,
    );
}

function modelInput(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional) {
    return optionalInput(schema);
  }
  let input: z.ZodType = schema;
  if (schema instanceof z.ZodObject) {
    input = schema.safeExtend(
      Object.fromEntries(
        Object.entries(schema.shape).map(([key, value]) => [key, modelInput(value as z.ZodType)]),
      ),
    );
  } else if (schema instanceof z.ZodArray) {
    input = schema.clone({ ...schema.def, element: modelInput(schema.element as z.ZodType) });
  } else if (schema instanceof z.ZodNullable) {
    input = modelInput(schema.unwrap() as z.ZodType).nullable();
  } else if (schema instanceof z.ZodUnion) {
    input = z.union(schema.options.map((value) => modelInput(value as z.ZodType)));
  }
  return input.meta(schema.meta() ?? {});
}

export function toolInput(inputSchema: Tool['inputSchema']) {
  const original = z.fromJSONSchema(inputSchema as z.core.JSONSchema.JSONSchema);
  const input = modelInput(original);
  return {
    parameters: Type.Unsafe<Record<string, unknown>>(z.toJSONSchema(input, { io: 'input' })),
    parse: (args: unknown): Record<string, unknown> =>
      z.record(z.string(), z.unknown()).parse(original.parse(input.parse(args))),
  };
}
