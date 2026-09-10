import { writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import {
  backendDirectory,
  type ContractProvenance,
  contractPath,
  contractSha256,
  contractSourceUrl,
  FULL_COMMIT_SHA_PATTERN,
  OPEN_CONNECTOR_CONTRACT_PATH,
  OPEN_CONNECTOR_REPOSITORY,
  provenancePath,
  verifyContractProvenance,
} from './record-delivery-contract-source.ts';

type FetchContract = (input: { url: string; init?: RequestInit }) => Promise<Response>;

const networkFetch: FetchContract = async ({ url, init }) => await fetch(url, init);

export async function resolveCommit({
  reference,
  fetchContract = networkFetch,
}: {
  reference: string;
  fetchContract?: FetchContract;
}): Promise<string> {
  if (FULL_COMMIT_SHA_PATTERN.test(reference)) {
    return reference;
  }

  const release = await githubJson({
    fetchContract,
    path: `/releases/tags/${encodeURIComponent(reference)}`,
    failure: `${reference} is not a full commit SHA or published OpenConnector release tag.`,
  });
  if (release.tag_name !== reference) {
    throw new Error('GitHub returned an unexpected OpenConnector release tag.');
  }
  const commit = await githubJson({
    fetchContract,
    path: `/commits/${encodeURIComponent(reference)}`,
    failure: `Could not resolve OpenConnector release ${reference} to a commit.`,
  });
  if (typeof commit.sha !== 'string' || !FULL_COMMIT_SHA_PATTERN.test(commit.sha)) {
    throw new Error('GitHub returned an invalid OpenConnector commit SHA.');
  }
  return commit.sha;
}

async function githubJson({
  fetchContract,
  path,
  failure,
}: {
  fetchContract: FetchContract;
  path: string;
  failure: string;
}) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetchContract({
    url: `https://api.github.com/repos/${OPEN_CONNECTOR_REPOSITORY}${path}`,
    init: {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'context-use-contract-updater',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  });
  if (!response.ok) {
    throw new Error(failure);
  }
  return (await response.json()) as Record<string, unknown>;
}

function assertExpectedContract(source: string): void {
  const document = parse(source) as {
    openapi?: unknown;
    components?: { schemas?: Record<string, unknown> };
  };
  if (
    typeof document.openapi !== 'string' ||
    !document.openapi.startsWith('3.1.') ||
    !document.components?.schemas?.RecordDeliveryEnvelope
  ) {
    throw new Error('Downloaded file is not the expected OpenConnector OpenAPI contract.');
  }
}

async function updateContract({
  requestedRef,
  fetchContract = networkFetch,
}: {
  requestedRef: string;
  fetchContract?: FetchContract;
}): Promise<string> {
  const resolvedCommit = await resolveCommit({ reference: requestedRef, fetchContract });
  const sourceUrl = contractSourceUrl(resolvedCommit);
  const response = await Promise.resolve(fetchContract({ url: sourceUrl }));
  if (!response.ok) {
    throw new Error(
      `Could not download the OpenConnector record delivery contract (${response.status}).`,
    );
  }
  const source = await response.text();
  assertExpectedContract(source);

  const provenance: ContractProvenance = {
    repository: OPEN_CONNECTOR_REPOSITORY,
    path: OPEN_CONNECTOR_CONTRACT_PATH,
    requestedRef,
    resolvedCommit,
    sourceUrl,
    sha256: contractSha256(source),
  };
  verifyContractProvenance({ source, provenance });

  await Promise.all([
    writeFile(contractPath, source),
    writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`),
  ]);

  const generator = Bun.spawnSync({
    cmd: ['bun', 'run', 'scripts/generate-record-delivery-contract.ts'],
    cwd: backendDirectory,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (generator.exitCode !== 0) {
    throw new Error('Could not generate the updated record delivery contract.');
  }
  return resolvedCommit;
}

if (import.meta.main) {
  const requestedRef = Bun.argv[2];
  if (!requestedRef) {
    throw new Error(
      'Usage: bun run update:delivery-contract -- <full OpenConnector commit SHA or release tag>',
    );
  }
  const resolvedCommit = await updateContract({ requestedRef });
  console.log(`Pinned OpenConnector record delivery contract at ${resolvedCommit}.`);
}
