import { useForm } from '@tanstack/react-form';
import { useEffect } from 'react';
import { ReadableIdConflictError, ReadableIdRequiredError } from '../../lib/api-error';
import type { EntitySummary } from '../../queries/entities';
import type { KnowledgePageSummary } from '../../queries/pages';

const READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type KnowledgePageFormValues = {
  readableId?: string;
  markdown: string;
};

function validateReadableId({ value }: { value?: string }): string | undefined {
  return value && READABLE_ID_PATTERN.test(value)
    ? undefined
    : 'Use lowercase words separated by single hyphens.';
}

function validateMarkdown({ value }: { value: string }): string | undefined {
  return /^\s*# .+\n[\s\S]*\S/.test(value)
    ? undefined
    : 'Start with one H1 title and add content below it.';
}

function appendLink({ markdown, link }: { markdown: string; link: string }): string {
  return `${markdown.trimEnd()}${markdown.trim() ? '\n\n' : ''}${link}`;
}

export function KnowledgePageForm({
  initialValues,
  readableIdLocked = false,
  entities,
  pages,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initialValues: KnowledgePageFormValues;
  readableIdLocked?: boolean;
  entities: EntitySummary[];
  pages: KnowledgePageSummary[];
  pending: boolean;
  error: Error | null;
  submitLabel: string;
  onSubmit: (values: KnowledgePageFormValues) => void;
}) {
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: ({ value }) => {
      onSubmit({
        readableId: value.readableId?.trim() || undefined,
        markdown: value.markdown.trim(),
      });
    },
  });
  const conflictingReadableId = error instanceof ReadableIdConflictError ? error.readableId : null;
  const readableIdIssue =
    error instanceof ReadableIdConflictError || error instanceof ReadableIdRequiredError;

  useEffect(() => {
    if (conflictingReadableId && !form.getFieldValue('readableId')) {
      form.setFieldValue('readableId', conflictingReadableId);
    }
  }, [form, conflictingReadableId]);

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="surface grid gap-5">
        <form.Field
          name="markdown"
          validators={{ onMount: validateMarkdown, onChange: validateMarkdown }}
        >
          {(field) => (
            <label className="field">
              <span>Markdown</span>
              <textarea
                name={field.name}
                rows={18}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
                spellCheck
                className="font-mono"
              />
              <small>
                Keep one coherent idea here. Use H2 or lower headings for linkable sections.
              </small>
              {field.state.meta.isTouched && field.state.meta.errors[0] && (
                <em role="alert">{field.state.meta.errors[0]}</em>
              )}
            </label>
          )}
        </form.Field>

        {readableIdIssue && !readableIdLocked && (
          <form.Field
            name="readableId"
            validators={{ onMount: validateReadableId, onChange: validateReadableId }}
          >
            {(field) => (
              <label className="field conflict-field">
                <span>
                  {conflictingReadableId ? 'Choose a distinct readable ID' : 'Choose a readable ID'}
                </span>
                <input
                  name={field.name}
                  value={field.state.value ?? ''}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
                />
                <small>
                  <code>
                    context-use://page/{field.state.value || conflictingReadableId || 'readable-id'}
                  </code>{' '}
                  is the permanent address.{' '}
                  {conflictingReadableId
                    ? 'Add a distinguishing word rather than a number when possible.'
                    : 'Use short lowercase words separated by hyphens.'}
                </small>
                {field.state.meta.isTouched && field.state.meta.errors[0] && (
                  <em role="alert">{field.state.meta.errors[0]}</em>
                )}
              </label>
            )}
          </form.Field>
        )}
      </div>

      {(entities.length > 0 || pages.length > 0) && (
        <aside className="link-palette" aria-label="Insert an internal link">
          <div>
            <h3>Mention an entity</h3>
            <div className="chip-row">
              {entities.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() =>
                    form.setFieldValue('markdown', (markdown) =>
                      appendLink({
                        markdown,
                        link: `[${entity.name}](context-use://entity/${entity.readableId})`,
                      }),
                    )
                  }
                >
                  @{entity.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>Reference a page</h3>
            <div className="chip-row">
              {pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() =>
                    form.setFieldValue('markdown', (markdown) =>
                      appendLink({
                        markdown,
                        link: `[${page.title}](context-use://page/${page.readableId})`,
                      }),
                    )
                  }
                >
                  {page.title}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}

      {error && !readableIdIssue && <p className="error-message">{error.message}</p>}

      <form.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <button
            className="primary-action justify-self-start"
            type="submit"
            disabled={!canSubmit || pending}
          >
            {pending ? 'Saving…' : submitLabel}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
}
