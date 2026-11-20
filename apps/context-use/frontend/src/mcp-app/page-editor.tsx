import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { type Page, type PagesClient, PageToolError } from './client';
import { PageMarkdown } from './page-markdown';

export function PageEditor({
  client,
  page,
  onSaved,
  onCancel,
}: {
  client: PagesClient;
  page?: Page;
  onSaved: (page: Page) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [confirmedPublicEdit, setConfirmedPublicEdit] = useState(false);
  const save = useMutation({
    mutationFn: (values: { markdown: string; temporalCoverage: string; allowDuplicate: boolean }) =>
      client.save({ ...values, page, temporalCoverage: values.temporalCoverage.trim() || null }),
    onSuccess: onSaved,
  });
  const form = useForm({
    defaultValues: {
      markdown: page?.markdown ?? '# \n\n',
      temporalCoverage: page?.temporalCoverage ?? '',
      allowDuplicate: false,
    },
    onSubmit: ({ value }) => save.mutateAsync(value).catch(() => {}),
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending || (page?.publication.isPublic && !confirmedPublicEdit)) {
          return;
        }
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-xl">{page ? 'Edit page' : 'New page'}</h1>
        <div className="flex gap-2">
          <Button variant="outline" type="button" disabled={save.isPending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || (page?.publication.isPublic && !confirmedPublicEdit)}
          >
            {save.isPending ? 'Saving…' : 'Save page'}
          </Button>
        </div>
      </div>
      {page?.publication.isPublic && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmedPublicEdit}
            onChange={(event) => setConfirmedPublicEdit(event.target.checked)}
          />
          <span>This page is public. I want to edit this page.</span>
        </label>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm">
          Start with one # title, followed by your page content.
        </span>
        <Button type="button" variant="outline" onClick={() => setPreview(!preview)}>
          {preview ? 'Edit Markdown' : 'Preview'}
        </Button>
      </div>
      <form.Field name="markdown">
        {(field) =>
          preview ? (
            <PageMarkdown markdown={field.state.value} />
          ) : (
            <div className="grid gap-2">
              <label htmlFor="page-markdown" className="font-medium text-sm">
                Page content (Markdown)
              </label>
              <Textarea
                id="page-markdown"
                className="min-h-72 font-mono"
                value={field.state.value}
                disabled={save.isPending}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </div>
          )
        }
      </form.Field>
      <form.Field name="temporalCoverage">
        {(field) => (
          <div className="grid gap-2">
            <label htmlFor="page-interval" className="font-medium text-sm">
              Interval (optional)
            </label>
            <Input
              id="page-interval"
              placeholder="For example, 2026 or 2026-03/2026-08"
              maxLength={MAX_TEMPORAL_COVERAGE_LENGTH}
              value={field.state.value}
              disabled={save.isPending}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </div>
        )}
      </form.Field>
      {save.error && (
        <div role="alert" className="grid gap-3 text-sm">
          <p>{save.error.message}</p>
          {save.error instanceof PageToolError && save.error.code === 'revision_conflict' && (
            <p>
              Your draft is preserved. Copy it before cancelling, then reopen the latest page to
              reconcile the changes.
            </p>
          )}
          {save.error instanceof PageToolError && save.error.code === 'page_title_conflict' && (
            <form.Field name="allowDuplicate">
              {(field) => (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={field.state.value}
                    onChange={(event) => field.handleChange(event.target.checked)}
                  />
                  Use this title anyway
                </label>
              )}
            </form.Field>
          )}
        </div>
      )}
    </form>
  );
}
