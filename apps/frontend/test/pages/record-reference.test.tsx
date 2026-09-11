import { afterEach, expect, test } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { KnowledgeLinkTextarea } from '../../src/components/pages/knowledge-link-textarea';
import { KnowledgePageMarkdown } from '../../src/components/pages/knowledge-page-markdown';
import type { ExternalRecordSummary } from '../../src/queries/records';

afterEach(cleanup);

const record: ExternalRecordSummary = {
  readableId: 'source-record',
  title: 'Launch [decision]',
  provider: 'github',
  kind: 'issue',
  recordId: '1',
  sync: { readableId: 'sync', name: 'Source sync' },
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  createdAt: new Date('2026-09-11'),
  updatedAt: new Date('2026-09-11'),
};

function ReferenceEditor() {
  const [markdown, setMarkdown] = useState('# Evidence\n\nSee ');
  const [preview, setPreview] = useState(false);
  return preview ? (
    <KnowledgePageMarkdown markdown={markdown} />
  ) : (
    <>
      <KnowledgeLinkTextarea
        id="markdown"
        name="markdown"
        value={markdown}
        entities={[]}
        pages={[]}
        assets={[]}
        records={[record]}
        invalid={false}
        onBlur={() => undefined}
        onChange={setMarkdown}
        onQueryChange={() => undefined}
      />
      <button type="button" onClick={() => setPreview(true)}>
        Preview
      </button>
    </>
  );
}

test('the @ picker identifies records, inserts a labelled reference, and preview navigates to the record', async () => {
  const root = createRootRoute({ component: Outlet });
  const editor = createRoute({ getParentRoute: () => root, path: '/', component: ReferenceEditor });
  const target = createRoute({
    getParentRoute: () => root,
    path: '/records/$id',
    component: () => <h1>Source record detail</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([editor, target]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  const textarea = screen.getByRole('combobox');
  await user.type(textarea, '@Launch');
  const suggestion = screen.getByRole('option', {
    name: /Launch \[decision\] github · issue Record/,
  });
  expect(suggestion.getAttribute('aria-selected')).toBe('true');
  await user.keyboard('{Enter}');
  expect((textarea as HTMLTextAreaElement).value).toBe(
    '# Evidence\n\nSee [Launch \\[decision\\]](context-use://record/source-record) ',
  );
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  const link = screen.getByRole('link', { name: record.title });
  expect(link.getAttribute('href')).toBe('/records/source-record?view=preview');
  await user.click(link);
  expect(await screen.findByRole('heading', { name: 'Source record detail' })).toBeTruthy();
});

test('unavailable references retain their labels without navigation and become links after restoration', async () => {
  function Preview() {
    const [available, setAvailable] = useState(false);
    return (
      <>
        <KnowledgePageMarkdown
          markdown={
            '# Evidence\n\nSee [Launch decision](context-use://record/source-record) and [Current research](context-use://record/current-record).'
          }
          recordReferences={[
            { readableId: 'source-record', available },
            { readableId: 'current-record', available: true },
          ]}
        />
        <button type="button" onClick={() => setAvailable(true)}>
          Restore source
        </button>
      </>
    );
  }
  const root = createRootRoute({ component: Preview });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  expect(screen.getByText('Launch decision', { exact: false })).toBeTruthy();
  expect(screen.getByText('(record unavailable)')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Launch decision' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Current research' })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Restore source' }));
  expect(screen.getByRole('link', { name: 'Launch decision' }).getAttribute('href')).toBe(
    '/records/source-record?view=preview',
  );
  expect(screen.queryByText('(record unavailable)')).toBeNull();
});
