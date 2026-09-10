import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const OPEN_CONNECTOR_REPOSITORY = 'massimoalbarello/open-connector';
export const OPEN_CONNECTOR_CONTRACT_PATH = 'docs/record-delivery.openapi.yaml';
export const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export const backendDirectory = process.cwd();
export const contractPath = join(
  backendDirectory,
  'contracts/open-connector-record-delivery.openapi.yaml',
);
export const provenancePath = join(
  backendDirectory,
  'contracts/open-connector-record-delivery.provenance.json',
);

export interface ContractProvenance {
  repository: typeof OPEN_CONNECTOR_REPOSITORY;
  path: typeof OPEN_CONNECTOR_CONTRACT_PATH;
  requestedRef: string;
  resolvedCommit: string;
  sourceUrl: string;
  sha256: string;
}

export function contractSourceUrl(commit: string): string {
  return `https://raw.githubusercontent.com/${OPEN_CONNECTOR_REPOSITORY}/${commit}/${OPEN_CONNECTOR_CONTRACT_PATH}`;
}

export function contractSha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export function verifyContractProvenance({
  source,
  provenance,
}: {
  source: string;
  provenance: unknown;
}): ContractProvenance {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('Record delivery contract provenance must be a JSON object.');
  }
  const value = provenance as Partial<ContractProvenance>;
  if (
    value.repository !== OPEN_CONNECTOR_REPOSITORY ||
    value.path !== OPEN_CONNECTOR_CONTRACT_PATH ||
    typeof value.requestedRef !== 'string' ||
    value.requestedRef.length === 0 ||
    typeof value.resolvedCommit !== 'string' ||
    !FULL_COMMIT_SHA_PATTERN.test(value.resolvedCommit) ||
    value.sourceUrl !== contractSourceUrl(value.resolvedCommit) ||
    typeof value.sha256 !== 'string' ||
    value.sha256 !== contractSha256(source)
  ) {
    throw new Error(
      'Record delivery contract provenance is invalid or does not match the pinned source.',
    );
  }
  return value as ContractProvenance;
}

export async function readPinnedContract(): Promise<{
  source: string;
  provenance: ContractProvenance;
}> {
  const [source, provenanceJson] = await Promise.all([
    readFile(contractPath, 'utf8'),
    readFile(provenancePath, 'utf8'),
  ]);
  const provenance = verifyContractProvenance({
    source,
    provenance: JSON.parse(provenanceJson) as unknown,
  });
  return { source, provenance };
}
