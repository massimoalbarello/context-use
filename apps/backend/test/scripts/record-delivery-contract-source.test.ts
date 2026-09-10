import { expect, test } from 'bun:test';
import {
  type ContractProvenance,
  contractSha256,
  contractSourceUrl,
  OPEN_CONNECTOR_CONTRACT_PATH,
  OPEN_CONNECTOR_REPOSITORY,
  verifyContractProvenance,
} from '../../scripts/record-delivery-contract-source.ts';
import { resolveCommit } from '../../scripts/update-record-delivery-contract.ts';

const COMMIT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SOURCE = 'openapi: 3.1.1\n';

function provenance(): ContractProvenance {
  return {
    repository: OPEN_CONNECTOR_REPOSITORY,
    path: OPEN_CONNECTOR_CONTRACT_PATH,
    requestedRef: 'v1.0.0',
    resolvedCommit: COMMIT,
    sourceUrl: contractSourceUrl(COMMIT),
    sha256: contractSha256(SOURCE),
  };
}

test('accepts an exact pinned contract and immutable OpenConnector provenance', () => {
  expect(verifyContractProvenance({ source: SOURCE, provenance: provenance() })).toEqual(
    provenance(),
  );
});

test('rejects edited contract bytes and provenance that does not resolve to its recorded commit', () => {
  expect(() =>
    verifyContractProvenance({ source: `${SOURCE}# edited\n`, provenance: provenance() }),
  ).toThrow('does not match the pinned source');
  expect(() =>
    verifyContractProvenance({
      source: SOURCE,
      provenance: { ...provenance(), sourceUrl: 'https://example.com/contract.yaml' },
    }),
  ).toThrow('does not match the pinned source');
});

test('uses a full commit directly and resolves only published release tags through GitHub', async () => {
  expect(
    await resolveCommit({
      reference: COMMIT,
      fetchContract: () => {
        throw new Error('A full commit must not require reference resolution.');
      },
    }),
  ).toBe(COMMIT);

  const requestedUrls: string[] = [];
  const resolved = await resolveCommit({
    reference: 'v1.0.0',
    fetchContract: ({ url }) => {
      requestedUrls.push(url);
      return Promise.resolve(
        Response.json(url.includes('/releases/tags/') ? { tag_name: 'v1.0.0' } : { sha: COMMIT }),
      );
    },
  });
  expect(resolved).toBe(COMMIT);
  expect(requestedUrls).toEqual([
    'https://api.github.com/repos/massimoalbarello/open-connector/releases/tags/v1.0.0',
    'https://api.github.com/repos/massimoalbarello/open-connector/commits/v1.0.0',
  ]);
  await expect(
    resolveCommit({
      reference: 'main',
      fetchContract: () => Promise.resolve(new Response(null, { status: 404 })),
    }),
  ).rejects.toThrow('not a full commit SHA or published OpenConnector release tag');
});
