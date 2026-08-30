import { useForm } from '@tanstack/react-form';
import { useEffect, useState } from 'react';
import { ReadableIdConflictError, ReadableIdRequiredError } from '../../lib/api-error';
import { useEntitySuggestions } from '../../lib/hooks/use-entities';
import { usePageSuggestions } from '../../lib/hooks/use-pages';
import { KnowledgeLinkTextarea } from './knowledge-link-textarea';

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

export function KnowledgePageForm({
  initialValues,
  readableIdLocked = false,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initialValues: KnowledgePageFormValues;
  readableIdLocked?: boolean;
  pending: boolean;
  error: Error | null;
  submitLabel: string;
  onSubmit: (values: KnowledgePageFormValues) => void;
}) {
  const [knowledgeQuery, setKnowledgeQuery] = useState<string | null>(null);
  const { data: entitySuggestions = [] } = useEntitySuggestions(knowledgeQuery);
  const { data: pageSuggestions = [] } = usePageSuggestions(knowledgeQuery);
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
      <div className="editor-fields">
        <form.Field
          name="markdown"
          validators={{ onMount: validateMarkdown, onChange: validateMarkdown }}
        >
          {(field) => (
            <label className="field" htmlFor={field.name}>
              <span>Markdown</span>
              <KnowledgeLinkTextarea
                id={field.name}
                name={field.name}
                value={field.state.value}
                entities={entitySuggestions}
                pages={pageSuggestions}
                invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
                onQueryChange={setKnowledgeQuery}
              />
              <small>
                Keep one coherent idea here. Type @ to mention an entity or reference a page; use H2
                or lower headings for linkable sections.
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
