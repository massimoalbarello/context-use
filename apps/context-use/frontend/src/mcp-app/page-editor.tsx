import { Button } from '@repo/ui/button';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { PageForm } from '../components/pages/page-form';
import { PageMarkdownTextarea } from '../components/pages/page-markdown-textarea';
import { FieldLabel } from '../components/ui/field';
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
    mutationFn: (values: Parameters<PagesClient['save']>[0]) => client.save(values),
    onSuccess: onSaved,
  });
  const submitDisabled = !!page?.publication.isPublic && !confirmedPublicEdit;
  const error = save.error;
  return (
    <PageForm
      onCancel={onCancel}
      pending={save.isPending}
      submitDisabled={submitDisabled}
      error={
        error && (
          <>
            {error.message}
            {error instanceof PageToolError && error.code === 'revision_conflict' && (
              <p>
                Your draft is preserved. Copy it before cancelling, then reopen the latest page to
                reconcile the changes.
              </p>
            )}
          </>
        )
      }
      duplicateTitle={
        !page && error instanceof PageToolError && error.code === 'page_title_conflict'
      }
      initialValues={page}
      onSubmit={(values) => save.mutate({ ...values, page })}
      header={({ intervalField, actions }) => (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-semibold text-xl">{page ? 'Edit page' : 'New page'}</h1>
            <fieldset disabled={save.isPending} className="flex gap-2">
              {actions}
            </fieldset>
          </div>
          {intervalField}
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
        </>
      )}
      markdownInput={({ id, name, value, invalid, onBlur, onChange }) =>
        preview ? (
          <PageMarkdown markdown={value} />
        ) : (
          <>
            <FieldLabel htmlFor={id}>Page content (Markdown)</FieldLabel>
            <PageMarkdownTextarea
              id={id}
              name={name}
              value={value}
              aria-invalid={invalid}
              disabled={save.isPending}
              onBlur={onBlur}
              onChange={(event) => onChange(event.target.value)}
            />
          </>
        )
      }
    />
  );
}
