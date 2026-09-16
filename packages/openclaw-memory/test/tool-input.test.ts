import { expect, test } from 'bun:test';
import { z } from 'zod';
import { toolInput, toolInputFromSchema } from '../src/tool-input';

const MAX_RESULTS = 50;
const MAX_TAGS = 3;
const original = z.object({
  query: z.string().min(1),
  cursor: z.string().min(1).optional(),
  recordFilter: z.object({ provider: z.string().min(1).optional() }).optional(),
  entityType: z.enum(['person', 'place']).nullable().optional(),
  limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
  tags: z.array(z.string()).min(1).max(MAX_TAGS).optional(),
});
const bridge = toolInput(z.toJSONSchema(original) as Parameters<typeof toolInput>[0]);

test('local tool schemas preserve normalization and validation while accepting provider omissions', () => {
  const local = toolInputFromSchema(
    z.object({
      name: z.string().trim().min(1),
      reasons: z.array(z.object({ reason: z.string().min(1) })).optional(),
    }),
  );
  const args = { name: '  Exhibition photo  ', reasons: null };
  expect(
    z.fromJSONSchema(JSON.parse(JSON.stringify(local.parameters))).safeParse(args).success,
  ).toBe(true);
  expect(local.parse(args)).toEqual({ name: 'Exhibition photo', reasons: undefined });
  expect(() => local.parse({ name: '   ' })).toThrow();
  expect(() => local.parse({ name: 'Photo', reasons: [{ reason: '' }] })).toThrow();
});

test('provider schemas can express omission without inventing filters or cursors', async () => {
  // This public SDK entry point ships without declarations in the pinned host.
  const sdk = 'openclaw/plugin-sdk/provider-tools';
  const { normalizeOpenAIToolSchemas } = await import(sdk);
  const [tool] = normalizeOpenAIToolSchemas({
    provider: 'openai',
    modelApi: 'openai-chatgpt-responses',
    tools: [{ name: 'memory', parameters: bridge.parameters }],
  });
  const input = {
    query: 'Mira',
    cursor: null,
    recordFilter: null,
    entityType: null,
    limit: null,
    tags: null,
  };
  expect(z.fromJSONSchema(tool!.parameters!).safeParse(input).success).toBe(true);
  expect(JSON.parse(JSON.stringify(bridge.parse(input)))).toEqual({ query: 'Mira' });
  expect(bridge.parse({ query: 'Mira' })).toEqual({ query: 'Mira' });
});

test('nullable updates distinguish leaving a field alone from clearing it', () => {
  expect(bridge.parse({ query: 'Mira', entityType: { value: null } })).toEqual({
    query: 'Mira',
    entityType: null,
  });
  expect(bridge.parse({ query: 'Mira', entityType: { value: 'person' } }).entityType).toBe(
    'person',
  );
  expect(bridge.parse({ query: 'Mira', recordFilter: { provider: null } }).recordFilter).toEqual({
    provider: undefined,
  });
});

test('invalid required values and array or numeric bounds still fail before an MCP call', () => {
  expect(() => bridge.parse({ query: null })).toThrow();
  expect(() => bridge.parse({ query: 'Mira', limit: 0 })).toThrow();
  expect(() => bridge.parse({ query: 'Mira', tags: [] })).toThrow();
  expect(
    z
      .fromJSONSchema(JSON.parse(JSON.stringify(bridge.parameters)))
      .safeParse({ query: 'Mira', tags: [] }).success,
  ).toBe(false);
});
