import { expect, test } from 'bun:test';
import { type RecordContent, validateRecordDeliveryEnvelope } from '#models/records/model.ts';

const GOLDEN_INTEGER = 3;
const GOLDEN_DECIMAL = 1.25;

test('accepts the record delivery canonical content-hash golden vector', () => {
  const content = {
    body: '# Résumé 🚀\n\nCafé',
    sourceUrl: 'https://github.example/acme/repo/pull/42',
    sourceUpdatedAt: '2026-09-09T08:30:00.000Z',
    sourceCreatedAt: '2026-09-08T12:00:00.000Z',
    participants: [
      {
        roles: ['author', 'reviewer'],
        name: 'Zoë',
        identities: [
          { namespace: 'github', id: '42' },
          { id: 'alice@example.com', namespace: 'email' },
        ],
      },
      {
        roles: ['author'],
        identities: [{ namespace: 'github', id: '7' }],
      },
    ],
    attributes: {
      zeta: -0,
      nested: { zebra: '最後', alpha: [GOLDEN_INTEGER, { y: true, x: null }] },
      alpha: ['é', GOLDEN_DECIMAL, false],
    },
  } satisfies RecordContent;

  expect(() =>
    validateRecordDeliveryEnvelope({
      version: 1,
      batchId: 'golden-batch',
      records: [
        {
          eventId: 'golden-event',
          provider: 'github',
          sourceId: 'github.example/acme/repo',
          kind: 'pull-request',
          id: '42',
          revision: 1,
          operation: 'added',
          contentHash: '0b8d9b6e8910e8d09363149cf908e3de8cdc817a5a7db33080ec16df10c58c5f',
          committedAt: '2026-09-09T09:00:00.000Z',
          content,
        },
      ],
    }),
  ).not.toThrow();
});
