import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceDetailActions } from '../../src/components/knowledge/resource-detail-actions';
import { ConnectionNameForm } from '../../src/components/mcp-connections/connection-name-form';

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

test('authenticated clients are read-only until the shared edit action is selected', async () => {
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
          {
            id: 'connection-2',
            name: 'Claude MacBook Pro',
            verifiedClientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
            archivedAt: '2026-09-01T01:00:00.000Z',
          },
        ]}
      />
    </QueryClientProvider>,
  );

  expect(viewHtml).toContain('Edit client');
  expect(viewHtml).toContain('>Archive</button>');
  expect(viewHtml).toContain('Authenticated clients');
  expect(viewHtml).toContain('Archived clients');
  expect(viewHtml).not.toContain('Verified client identity');
  expect(viewHtml).not.toContain('Registered OAuth client');
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

test('the client name editor replaces the card title without a second visible label', () => {
  const editorHtml = renderToStaticMarkup(
    <ConnectionNameForm
      initialName="Codex MacBook Pro"
      pending={false}
      error={null}
      presentation="card-title"
      onSubmit={() => undefined}
    />,
  );

  expect(editorHtml).toContain('value="Codex MacBook Pro"');
  expect(editorHtml).toContain('sr-only" for=');
  expect(editorHtml).toContain('Connection name</label>');
});
