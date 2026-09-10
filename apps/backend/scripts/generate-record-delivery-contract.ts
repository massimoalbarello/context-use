import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JSONSchema } from 'json-schema-to-typescript';
import { compile } from 'json-schema-to-typescript';
import { jsonSchemaToZod } from 'json-schema-to-zod';
import { parse } from 'yaml';
import { backendDirectory, readPinnedContract } from './record-delivery-contract-source.ts';

const modelOutputPath = join(backendDirectory, 'src/models/records/delivery-contract.generated.ts');
const routeOutputPath = join(
  backendDirectory,
  'src/routes/api/records/delivery-model.generated.ts',
);
const { source } = await readPinnedContract();
const document = parse(source) as OpenApiDocument;
const envelope = requireSchema({ document, name: 'RecordDeliveryEnvelope' });
const recordContent = requireSchema({ document, name: 'RecordContent' });
const definitions = document.components.schemas;
const resolvedSchema = resolveComponentReferences({
  value: { ...envelope, $schema: 'https://json-schema.org/draft/2020-12/schema' },
  definitions,
}) as JSONSchema;
const runtimeSchema = normalizeOperationUnions(resolvedSchema) as JSONSchema;
const typeSchema = { ...runtimeSchema };
delete typeSchema.title;
const declarations = await compile(typeSchema, 'RecordDeliveryEnvelope', {
  additionalProperties: false,
  bannerComment: '',
  ignoreMinAndMaxItems: true,
  style: { singleQuote: true },
});
const version = requireNumber({ value: envelope.properties?.version?.const, name: 'version' });
const maximumBatchRecords = requireNumber({
  value: envelope.properties?.records?.maxItems,
  name: 'maximum batch records',
});
const maximumDeliveryBytes = requireNumber({
  value: envelope['x-open-connector-maximum-body-bytes'],
  name: 'maximum delivery bytes',
});
const maximumRecordBytes = requireNumber({
  value: envelope['x-open-connector-maximum-record-bytes'],
  name: 'maximum record bytes',
});
const maximumAttributesBytes = requireNumber({
  value: recordContent.properties?.attributes?.['x-open-connector-maximum-bytes'],
  name: 'maximum attributes bytes',
});
const modelSource = formatGenerated({
  path: modelOutputPath,
  source: `/** Generated from the pinned OpenConnector OpenAPI contract. Do not edit. */
/* biome-ignore-all lint: Generated code mirrors the external contract. */
export const RECORD_DELIVERY_VERSION = ${version} as const;
export const MAX_RECORD_DELIVERY_BATCH_RECORDS = ${maximumBatchRecords};
export const MAX_RECORD_DELIVERY_BYTES = ${maximumDeliveryBytes};
export const MAX_RECORD_CONTENT_BYTES = ${maximumRecordBytes};
export const MAX_RECORD_ATTRIBUTES_BYTES = ${maximumAttributesBytes};

${declarations}
export type DeliveredRecord = RecordDeliveryEnvelope['records'][number];
export type RecordOperation = DeliveredRecord['operation'];
export type RecordContent = Extract<
  DeliveredRecord,
  { operation: 'added' | 'updated' }
>['content'];
export type RecordParticipant = NonNullable<RecordContent['participants']>[number];
`,
});
const zodModule = jsonSchemaToZod(runtimeSchema, {
  module: 'esm',
  name: 'BaseRecordDeliveryEnvelopeSchema',
  zodVersion: 4,
});
const zodSchema = zodModule.replace(/^import \{ z \} from ['"]zod['"];?\n+/, '');
const routeSource = formatGenerated({
  path: routeOutputPath,
  source: `/** Generated from the pinned OpenConnector OpenAPI contract. Do not edit. */
/* biome-ignore-all lint: Generated code mirrors the external contract. */
import { z } from 'zod';
import {
  MAX_RECORD_ATTRIBUTES_BYTES,
  MAX_RECORD_CONTENT_BYTES,
} from '#models/records/delivery-contract.generated.ts';
${zodSchema}

export const RecordDeliveryEnvelopeSchema = BaseRecordDeliveryEnvelopeSchema.superRefine(
  (envelope, context) => {
    for (const record of envelope.records) {
      if (record.operation === 'deleted') continue;
      if (Buffer.byteLength(JSON.stringify(record.content), 'utf8') > MAX_RECORD_CONTENT_BYTES) {
        context.addIssue({ code: 'custom', message: 'Record content exceeds the delivery contract limit.' });
      }
      if (
        record.content.attributes !== undefined &&
        Buffer.byteLength(JSON.stringify(record.content.attributes), 'utf8') > MAX_RECORD_ATTRIBUTES_BYTES
      ) {
        context.addIssue({ code: 'custom', message: 'Record attributes exceed the delivery contract limit.' });
      }
    }
  },
);
`,
});

await writeOrCheck({ path: modelOutputPath, content: modelSource });
await writeOrCheck({ path: routeOutputPath, content: routeSource });

interface OpenApiDocument {
  components: { schemas: Record<string, OpenApiSchema> };
}

interface OpenApiSchema extends Record<string, unknown> {
  const?: unknown;
  maxItems?: unknown;
  properties?: Record<string, OpenApiSchema>;
}

function requireSchema({
  document,
  name,
}: {
  document: OpenApiDocument;
  name: string;
}): OpenApiSchema {
  const schema = document.components.schemas[name];
  if (!schema) {
    throw new Error(`Missing OpenAPI schema: ${name}.`);
  }
  return schema;
}

function requireNumber({ value, name }: { value: unknown; name: string }): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${name} in the OpenConnector record delivery contract.`);
  }
  return value;
}

function resolveComponentReferences({
  value,
  definitions,
}: {
  value: unknown;
  definitions: Record<string, OpenApiSchema>;
}): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveComponentReferences({ value: item, definitions }));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const object = value as Record<string, unknown>;
  if (typeof object.$ref === 'string') {
    const prefix = '#/components/schemas/';
    if (!object.$ref.startsWith(prefix)) {
      throw new Error(`Unsupported schema reference: ${object.$ref}.`);
    }
    const name = object.$ref.slice(prefix.length);
    const referenced = definitions[name];
    if (!referenced) {
      throw new Error(`Missing referenced OpenAPI schema: ${name}.`);
    }
    return resolveComponentReferences({ value: referenced, definitions });
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, child]) => [
      key,
      resolveComponentReferences({ value: child, definitions }),
    ]),
  );
}

/** Express equivalent multi-value operation branches as a Zod-compatible discriminated union. */
function normalizeOperationUnions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeOperationUnions);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const object = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeOperationUnions(child)]),
  );
  const variants = operationUnionVariants(object.oneOf);
  if (!variants) {
    return object;
  }
  return { ...object, oneOf: variants, discriminator: { propertyName: 'operation' } };
}

function operationUnionVariants(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const variants: Array<Record<string, unknown>> = [];
  for (const candidate of value) {
    const candidateVariants = operationVariants(candidate);
    if (!candidateVariants) {
      return null;
    }
    variants.push(...candidateVariants);
  }
  return variants;
}

function operationVariants(value: unknown): Array<Record<string, unknown>> | null {
  const schema = objectValue(value);
  const properties = objectValue(schema?.properties);
  const operationSchema = objectValue(properties?.operation);
  const values = operationValues(operationSchema);
  if (!schema || !properties || !operationSchema || !values) {
    return null;
  }
  const { enum: _enum, ...operationWithoutEnum } = operationSchema;
  return values.map((operationValue) => ({
    ...schema,
    properties: {
      ...properties,
      operation: { ...operationWithoutEnum, type: 'string', const: operationValue },
    },
  }));
}

function operationValues(schema: Record<string, unknown> | null): string[] | null {
  if (typeof schema?.const === 'string') {
    return [schema.const];
  }
  return Array.isArray(schema?.enum) && schema.enum.every((item) => typeof item === 'string')
    ? schema.enum
    : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatGenerated({ path, source }: { path: string; source: string }): string {
  const formatter = Bun.spawnSync({
    cmd: [
      join(backendDirectory, '../../node_modules/.bin/biome'),
      'format',
      '--stdin-file-path',
      path,
    ],
    stdin: new TextEncoder().encode(source),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (formatter.exitCode !== 0) {
    throw new Error(`Failed to format ${path}: ${formatter.stderr.toString()}`);
  }
  return formatter.stdout.toString();
}

async function writeOrCheck({ path, content }: { path: string; content: string }): Promise<void> {
  const existing = await readOptional(path);
  if (process.argv.includes('--check')) {
    if (existing !== content) {
      throw new Error('Record delivery contract is stale. Run bun run generate:delivery-contract.');
    }
    return;
  }
  if (existing !== content) {
    await writeFile(path, content);
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}
