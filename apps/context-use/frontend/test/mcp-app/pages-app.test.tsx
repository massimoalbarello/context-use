import { afterEach, expect, test } from 'bun:test';
import type { App } from '@modelcontextprotocol/ext-apps';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Page, PagesClient } from '../../src/mcp-app/client';
import { PagesApp } from '../../src/mcp-app/pages-app';
import { pageQueryKey } from '../../src/mcp-app/queries';

const page: Page = {
  address: 'context-use://page/notes',
  readableId: 'notes',
  title: 'Notes',
  excerpt: 'Things to remember.',
  publication: { isPublic: false, publishedRevisionNumber: null },
  temporalCoverage: null,
  revisionNumber: 1,
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  markdown: '# Notes\n\nThings to remember.',
  mentions: [],
  references: [],
  recordReferences: [],
  backlinks: [],
  revisions: [],
};

afterEach(cleanup);
function setup({ initial = null, call }: { initial?: Page | null; call: App['callServerTool'] }) {
  const client = new PagesClient({ callServerTool: call, openLink: () => Promise.resolve({}) });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (initial) {
    queryClient.setQueryData(pageQueryKey(initial.address), initial);
  }
  render(
    <QueryClientProvider client={queryClient}>
      <PagesApp client={client} initial={initial} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const success = (structuredContent: Record<string, unknown>) => ({
  content: [] as [],
  structuredContent,
});
const failure = ({ code, message }: { code: string; message: string }) => ({
  ...success({ error: { code, message } }),
  isError: true,
});

test('creates a page through the host and opens its saved content', async () => {
  let saved = false;
  const user = setup({
    call: ({ name, arguments: args }) => {
      switch (name) {
        case 'list_knowledge_pages':
          return Promise.resolve(
            success({ items: saved ? [page] : [], total: saved ? 1 : 0, nextCursor: null }),
          );
        case 'read_hypermedia_curation_guide':
          return Promise.resolve(success({ guide_version: 'current-guide' }));
        case 'create_knowledge_page':
          expect(args).toMatchObject({
            guide_version: 'current-guide',
            markdown: page.markdown,
            temporalCoverage: null,
          });
          saved = true;
          return Promise.resolve({
            ...success({ address: page.address, revisionNumber: 1 }),
            _meta: { page },
          });
        case 'read_knowledge_page':
          return Promise.resolve(success(page));
        default:
          throw new Error(`Unexpected ${name}`);
      }
    },
  });
  await screen.findByText(/No pages yet/);
  await user.click(screen.getByRole('button', { name: 'New page' }));
  const markdown = screen.getByRole('textbox', { name: 'Page content (Markdown)' });
  await user.clear(markdown);
  await user.type(markdown, page.markdown);
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save page' }));
  await screen.findByRole('button', { name: 'Edit page' });
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
});

test('keeps the draft after a concurrent revision conflict and never retries the write', async () => {
  let writes = 0;
  const user = setup({
    initial: page,
    call: ({ name, arguments: args }) => {
      if (name === 'read_knowledge_page') {
        return Promise.resolve(success(page));
      }
      if (name === 'read_hypermedia_curation_guide') {
        return Promise.resolve(success({ guide_version: 'current-guide' }));
      }
      expect(name).toBe('update_knowledge_page');
      expect(args).toMatchObject({ address: page.address, expectedRevisionNumber: 1 });
      writes++;
      return Promise.resolve(
        failure({ code: 'revision_conflict', message: 'The page changed since it was read.' }),
      );
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Edit page' }));
  const markdown = screen.getByRole('textbox', {
    name: 'Page content (Markdown)',
  }) as HTMLTextAreaElement;
  await user.type(markdown, '\n\nMy unsaved thought.');
  await user.click(screen.getByRole('button', { name: 'Save page' }));
  await screen.findByRole('alert');
  expect(markdown.value).toContain('My unsaved thought.');
  expect(writes).toBe(1);
});

test('requires a public-edit decision and a separate archive confirmation', async () => {
  const publicPage = { ...page, publication: { isPublic: true, publishedRevisionNumber: 1 } };
  let archiveCalls = 0;
  const user = setup({
    initial: publicPage,
    call: ({ name }) => {
      if (name === 'read_knowledge_page') {
        return Promise.resolve(success(publicPage));
      }
      if (name === 'read_hypermedia_curation_guide') {
        return Promise.resolve(success({ guide_version: 'current-guide' }));
      }
      expect(name).toBe('archive_knowledge_page');
      archiveCalls++;
      return Promise.resolve(
        failure({
          code: 'resource_published',
          message: 'Unpublish this resource before archiving.',
        }),
      );
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Edit page' }));
  expect((screen.getByRole('button', { name: 'Save page' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole('checkbox', { name: /This page is public/ }));
  expect((screen.getByRole('button', { name: 'Save page' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  await screen.findByRole('alertdialog');
  expect(archiveCalls).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Archive page' }));
  await screen.findByText('Unpublish this page in Context Use before archiving it.');
  expect(archiveCalls).toBe(1);
});

test('continues opaque pagination and can navigate to an archive blocker', async () => {
  let loads = 0;
  const blocker = {
    ...page,
    address: 'context-use://page/blocker',
    readableId: 'blocker',
    title: 'Blocker',
    markdown: '# Blocker\n\nReference to notes.',
  };
  const user = setup({
    call: ({ name, arguments: args }) => {
      if (name === 'list_knowledge_pages') {
        loads++;
        if (args?.cursor) {
          expect(args.cursor).toBe('opaque-cursor');
          return Promise.resolve(success({ items: [blocker], total: 2, nextCursor: null }));
        }
        return Promise.resolve(success({ items: [page], total: 2, nextCursor: 'opaque-cursor' }));
      }
      if (name === 'read_knowledge_page') {
        return Promise.resolve(success(args?.address === page.address ? page : blocker));
      }
      if (name === 'read_hypermedia_curation_guide') {
        return Promise.resolve(success({ guide_version: 'current-guide' }));
      }
      return Promise.resolve({
        ...success({
          error: {
            code: 'resource_in_use',
            message: 'This page is referenced.',
            blockers: [{ page: blocker }],
          },
        }),
        isError: true,
      });
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Load more pages' }));
  await screen.findByRole('button', { name: /Blocker Things/ });
  expect(loads).toBe(2);
  await user.click(screen.getByRole('button', { name: /Notes Things/ }));
  await user.click(await screen.findByRole('button', { name: 'Archive' }));
  await user.click(screen.getByRole('button', { name: 'Archive page' }));
  await user.click(await screen.findByRole('button', { name: 'Blocker' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Blocker' })).toBeTruthy());
});

test('renders untrusted Markdown without running HTML or fetching remote images', async () => {
  const { PageMarkdown } = await import('../../src/mcp-app/page-markdown');
  const opened: string[] = [];
  const user = userEvent.setup();
  render(
    <PageMarkdown
      markdown={
        '# Safe content\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))\n\n![Remote photo](https://tracking.example/pixel)\n\n[External](https://example.com)\n\n## A **formatted** heading'
      }
      onExternal={(url) => opened.push(url)}
    />,
  );
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('img')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'A formatted heading' }).id).toBe(
    'a-formatted-heading',
  );
  await user.click(screen.getByRole('link', { name: 'External' }));
  expect(opened).toEqual(['https://example.com']);
});
