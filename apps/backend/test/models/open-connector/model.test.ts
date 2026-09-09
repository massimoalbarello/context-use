import { expect, test } from 'bun:test';
import {
  type OpenConnectorRecordContent,
  validateOpenConnectorDeliveryEnvelope,
} from '#models/open-connector/model.ts';

const GOLDEN_INTEGER = 3;
const GOLDEN_DECIMAL = 1.25;

test('accepts the open-connector canonical content-hash golden vector', () => {
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
        roles: [],
        identities: [{ namespace: 'github', id: '7' }],
      },
    ],
    attributes: {
      zeta: -0,
      nested: { zebra: '最後', alpha: [GOLDEN_INTEGER, { y: true, x: null }] },
      alpha: ['é', GOLDEN_DECIMAL, false],
    },
  } satisfies OpenConnectorRecordContent;

  expect(() =>
    validateOpenConnectorDeliveryEnvelope({
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
          contentHash: '5d065c7fbe289878feb343a42ce3cef674e6b3fc67d6e69667d0d58fcfd66580',
          committedAt: '2026-09-09T09:00:00.000Z',
          content,
        },
      ],
    }),
  ).not.toThrow();
});
