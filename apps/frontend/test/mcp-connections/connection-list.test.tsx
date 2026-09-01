import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceDetailActions } from '../../src/components/knowledge/resource-detail-actions';

async function importConnectionList() {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'http://localhost' } },
  });
  try {
    return (await import('../../src/components/mcp-connections/connection-list')).ConnectionList;
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

test('connected clients are read-only until the shared edit action is selected', async () => {
  const ConnectionList = await importConnectionList();
  const queryClient = new QueryClient();
  const viewHtml = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ConnectionList
        connections={[
          {
            id: 'connection-1',
            name: 'Codex MacBook Pro',
            verifiedClientId: 'https://chatgpt.com/oauth/codex/client.json',
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
            archivedAt: null,
          },
        ]}
      />
    </QueryClientProvider>,
  );

  expect(viewHtml).toContain('Edit client');
  expect(viewHtml).toContain('>Archive</button>');
  expect(viewHtml).not.toContain('Connection name');
  expect(viewHtml).not.toContain('<input');

  const editActionsHtml = renderToStaticMarkup(
    <ResourceDetailActions
      mode="edit"
      resource="client"
      pending={false}
      onCancel={() => undefined}
    />,
  );
  expect(editActionsHtml).toContain('>Cancel</button>');
  expect(editActionsHtml).toContain('>Save client</button>');
  expect(editActionsHtml).not.toContain('Archive');
});
