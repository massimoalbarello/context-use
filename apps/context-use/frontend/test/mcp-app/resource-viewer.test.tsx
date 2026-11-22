import { afterEach, expect, test } from 'bun:test';
import type { App } from '@modelcontextprotocol/ext-apps';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialNotice, launchResource, McpAppClient, type Page } from '../../src/mcp-app/client';
import { resourceQueryKey } from '../../src/mcp-app/queries';
import { ResourceViewer } from '../../src/mcp-app/resource-viewer';

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
function setup({
  initial = null,
  call,
  observeSize = () => () => {},
}: {
  initial?: Page | null;
  call: App['callServerTool'];
  observeSize?: App['setupSizeChangedNotifications'];
}) {
  const client = new McpAppClient({
    callServerTool: call,
    setupSizeChangedNotifications: observeSize,
    openLink: () => Promise.resolve({}),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (initial) {
    queryClient.setQueryData(resourceQueryKey(initial.address), { kind: 'page', value: initial });
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ResourceViewer client={client} initialAddress={initial?.address ?? page.address} />
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

test('opens an explicitly presented address or saved page and ignores discovery data', () => {
  expect(launchResource(success(page)).address).toBeUndefined();
  expect(launchResource({ _meta: { address: page.address } }).address).toBe(page.address);
  expect(launchResource({ _meta: { page } })).toMatchObject({
    address: page.address,
    page: { kind: 'page', value: page },
  });
});

test('shows an outcome when a page write returns without a preview address', () => {
  expect(initialNotice(success({ archived: true }))).toContain('Page archived');
  expect(initialNotice(success({ code: 'hypermedia_curation_guide_required' }))).toContain(
    'curation guide changed',
  );
});

test('holds the iframe height until the selected page loads', async () => {
  const request = Promise.withResolvers<Awaited<ReturnType<App['callServerTool']>>>();
  let sizing = false;
  setup({
    call: () => request.promise,
    observeSize: () => {
      sizing = true;
      return () => {
        sizing = false;
      };
    },
  });
  await screen.findByText('Loading preview');
  expect(sizing).toBe(false);
  request.resolve(success(page));
  await screen.findByRole('heading', { name: 'Notes' });
  expect(sizing).toBe(true);
});

test('validates and saves through the host when native form submission is unavailable', async () => {
  const markdownWithSetextTitle = 'Notes\n=====\n\nThings to remember.';
  let saved = page;
  const user = setup({
    call: ({ name, arguments: args }) => {
      switch (name) {
        case 'read_hypermedia_curation_guide':
          return Promise.resolve(success({ guide_version: 'current-guide' }));
        case 'update_knowledge_page':
          expect(args).toMatchObject({
            address: page.address,
            expectedRevisionNumber: 1,
            guide_version: 'current-guide',
            markdown: markdownWithSetextTitle,
            temporalCoverage: '2026',
            changeMessage: 'First draft',
          });
          saved = { ...page, markdown: markdownWithSetextTitle, revisionNumber: 2 };
          return Promise.resolve({
            ...success({ address: page.address, revisionNumber: 1 }),
            _meta: { page: saved },
          });
        case 'read_knowledge_page':
          return Promise.resolve(success(saved));
        default:
          throw new Error(`Unexpected ${name}`);
      }
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Edit page' }));
  const markdown = await screen.findByRole('textbox', { name: 'Page content (Markdown)' });
  // A host iframe can allow scripts while blocking native form submission.
  (markdown as HTMLTextAreaElement).form!.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  await user.clear(markdown);
  await user.click(screen.getByRole('button', { name: 'Save page' }));
  await screen.findByText(/must start with one H1 title/);
  await user.type(markdown, markdownWithSetextTitle);
  await user.type(screen.getByRole('textbox', { name: 'Interval (optional)' }), '2026');
  await user.type(
    screen.getByRole('textbox', { name: 'Change summary (optional)' }),
    'First draft',
  );
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save page' }));
  await screen.findByText('Revision 2 · Private');
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
});

test('keeps the draft after a concurrent revision conflict and never retries the write', async () => {
  let writes = 0;
  const user = setup({
    initial: page,
    call: ({ name, arguments: args }) => {
      if (name === 'read_knowledge_page') {
        return Promise.resolve(
          success(
            writes
              ? { ...page, revisionNumber: 2, markdown: '# Notes\n\nChanged elsewhere.' }
              : page,
          ),
        );
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
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByText('Changed elsewhere.');
});

test('requires confirmation to edit a public page', async () => {
  const publicPage = { ...page, publication: { isPublic: true, publishedRevisionNumber: 1 } };
  const user = setup({
    initial: publicPage,
    call: ({ name }) => {
      expect(name).toBe('read_knowledge_page');
      return Promise.resolve(success(publicPage));
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
  expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
});

test('renders untrusted Markdown without running HTML or fetching remote images', async () => {
  const { PageMarkdown } = await import('../../src/mcp-app/page-detail');
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
