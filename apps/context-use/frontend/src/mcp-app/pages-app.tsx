import { Button } from '@repo/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { Page, PagesClient } from './client';
import { PageDetail } from './page-detail';
import { PageEditor } from './page-editor';
import { PagesList } from './pages-list';
import { pageQueryKey, pagesQueryKey } from './queries';

type View = { kind: 'browse' } | { kind: 'read'; address: string } | { kind: 'edit'; page?: Page };

export function PagesApp({
  client,
  initial,
  initialNotice = '',
}: {
  client: PagesClient;
  initial: Page | null;
  initialNotice?: string;
}) {
  const [view, setView] = useState<View>(
    initial ? { kind: 'read', address: initial.address } : { kind: 'browse' },
  );
  const [notice, setNotice] = useState(initialNotice);
  const queryClient = useQueryClient();
  const selectPage = (address: string) => {
    setView({ kind: 'read', address });
    setNotice('');
  };
  const browse = () => setView({ kind: 'browse' });
  const saved = (page: Page) => {
    queryClient.setQueryData(pageQueryKey(page.address), page);
    void queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    setView({ kind: 'read', address: page.address });
    setNotice('Page saved.');
  };
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-border border-b pb-4">
        <span className="font-semibold text-sm">
          context-use <span className="ml-2 font-normal text-muted-foreground">Pages</span>
        </span>
        {view.kind !== 'edit' && (
          <div className="flex gap-2">
            {view.kind === 'read' && (
              <Button variant="outline" onClick={browse}>
                All pages
              </Button>
            )}
            <Button
              onClick={() => {
                setView({ kind: 'edit' });
                setNotice('');
              }}
            >
              <Plus aria-hidden="true" />
              New page
            </Button>
          </div>
        )}
      </header>
      {notice && (
        <p role="status" className="mb-4 text-muted-foreground text-sm">
          {notice}
        </p>
      )}
      {view.kind === 'edit' && (
        <PageEditor
          client={client}
          page={view.page}
          onSaved={saved}
          onCancel={() => (view.page ? selectPage(view.page.address) : browse())}
        />
      )}
      {view.kind === 'read' && (
        <PageDetail
          key={view.address}
          client={client}
          address={view.address}
          onPage={selectPage}
          onEdit={(page) => {
            setView({ kind: 'edit', page });
            setNotice('');
          }}
          onArchived={() => {
            browse();
            setNotice('Page archived. You can restore it from the Archived filter in Context Use.');
          }}
        />
      )}
      {view.kind === 'browse' && <PagesList client={client} onPage={selectPage} />}
    </main>
  );
}
