import { Button, buttonVariants } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { KnowledgePageCardContent } from '../components/pages/knowledge-page-link';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { pagesQueryOptions } from '../queries/pages';
import {
  type PublicSiteSettings,
  publicSiteQueryKey,
  publicSiteQueryOptions,
  setHomepage,
} from '../queries/public-site';

export const Route = createFileRoute('/app/settings/public-site')({
  loader: ({ context }) => context.queryClient.ensureQueryData(publicSiteQueryOptions),
  component: PublicSiteSettingsRoute,
});

function PublicSiteSettingsRoute() {
  const { data } = useSuspenseQuery(publicSiteQueryOptions);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: setHomepage,
    onSettled: () => queryClient.invalidateQueries({ queryKey: publicSiteQueryKey }),
  });
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-semibold text-3xl tracking-tight">Public site</h1>
        <a href="/public" className={buttonVariants({ variant: 'outline' })}>
          View public site
        </a>
      </header>
      <HomepageSettings
        settings={data}
        pending={save.isPending}
        error={save.error}
        onSave={(readableId) => save.mutateAsync(readableId)}
      />
    </div>
  );
}

function HomepageSettings({
  settings,
  pending,
  error,
  onSave,
}: {
  settings: PublicSiteSettings;
  pending: boolean;
  error: Error | null;
  onSave: (readableId: string | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<{ readableId: string | null } | null>(null);

  return (
    <section className="grid max-w-2xl gap-5" aria-labelledby="homepage-heading">
      <div className="grid gap-2">
        <h2 id="homepage-heading" className="font-semibold text-xl">
          Homepage
        </h2>
        <p className="text-muted-foreground text-sm">
          Choose the published page visitors see first at your public site.
        </p>
      </div>
      {editing ? (
        <HomepagePicker
          initialReadableId={settings.homepage?.readableId ?? ''}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSelect={(readableId) => setConfirmation({ readableId })}
        />
      ) : (
        <div className="grid gap-4">
          {settings.homepage ? (
            <Link
              to="/app/pages/$id"
              params={{ id: settings.homepage.readableId }}
              className="font-medium underline underline-offset-4"
            >
              {settings.homepage.title}
            </Link>
          ) : (
            <p className="text-muted-foreground text-sm">
              Your public site shows “Nothing published yet”.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(true);
              }}
            >
              {settings.homepage ? 'Change homepage' : 'Set homepage'}
            </Button>
            {settings.homepage && (
              <Button variant="ghost" onClick={() => setConfirmation({ readableId: null })}>
                Remove homepage
              </Button>
            )}
          </div>
        </div>
      )}
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setConfirmation(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirmation?.readableId ? 'Set homepage?' : 'Remove homepage?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation?.readableId
              ? 'Visitors to your public site will start on this page.'
              : 'Your public site will show “Nothing published yet”. This page will stay published.'}
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" disabled={pending}>
                  Cancel
                </Button>
              }
            />
            <Button
              disabled={pending}
              onClick={() => {
                if (confirmation) {
                  void onSave(confirmation.readableId)
                    .then(() => {
                      setConfirmation(null);
                      setEditing(false);
                    })
                    .catch(() => undefined);
                }
              }}
            >
              {pending ? 'Saving…' : confirmation?.readableId ? 'Set homepage' : 'Remove homepage'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function HomepagePicker({
  initialReadableId,
  pending,
  onCancel,
  onSelect,
}: {
  initialReadableId: string;
  pending: boolean;
  onCancel: () => void;
  onSelect: (readableId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const pages = useInfiniteQuery({
    ...pagesQueryOptions({ visibility: 'public', query }),
  });
  const items = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const form = useForm({
    defaultValues: { readableId: initialReadableId },
    onSubmit: ({ value }) => onSelect(value.readableId),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Input
        aria-label="Find a published page"
        placeholder="Find a published page…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <form.Field name="readableId">
        {(field) => (
          <div
            className="grid max-h-80 gap-2 overflow-y-auto"
            role="radiogroup"
            aria-label="Published pages"
          >
            {items.map((page) => (
              <label
                key={page.readableId}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-checked:bg-muted"
              >
                <input
                  type="radio"
                  name={field.name}
                  value={page.readableId}
                  checked={field.state.value === page.readableId}
                  onChange={() => field.handleChange(page.readableId)}
                  className="accent-foreground"
                />
                <KnowledgePageCardContent page={page} />
              </label>
            ))}
          </div>
        )}
      </form.Field>
      {pages.isPending && (
        <p role="status" className="text-muted-foreground text-sm">
          Loading published pages…
        </p>
      )}
      {pages.error && (
        <div className="grid gap-2">
          <p role="alert" className="text-destructive text-sm">
            {pages.error.message}
          </p>
          <Button type="button" variant="outline" onClick={() => void pages.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {pages.isSuccess && items.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {query
            ? 'No published pages match your search.'
            : 'Publish a page before choosing a homepage.'}
        </p>
      )}
      {pages.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {pages.isFetchingNextPage ? 'Loading…' : 'Load more pages'}
        </Button>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => state.values.readableId}>
          {(readableId: string) => (
            <Button type="submit" disabled={!readableId || pending}>
              Set homepage
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
