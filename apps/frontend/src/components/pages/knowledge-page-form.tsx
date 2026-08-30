import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { ReadableIdConflictError, ReadableIdRequiredError } from '../../lib/api-error';
import { useEntitySuggestions } from '../../lib/hooks/use-entities';
import { usePageSuggestions } from '../../lib/hooks/use-pages';
import { ReadableIdField, validateReadableId } from '../knowledge/readable-id-field';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldGroup } from '../ui/field';
import { KnowledgeLinkTextarea } from './knowledge-link-textarea';

export type KnowledgePageFormValues = {
  readableId?: string;
  markdown: string;
};

type KnowledgePageFormProps = {
  initialValues: KnowledgePageFormValues;
  readableIdLocked?: boolean;
  pending: boolean;
  error: Error | null;
  onSubmit: (values: KnowledgePageFormValues) => void;
} & ({ submitLabel: string; formId?: never } | { formId: string; submitLabel?: never });

function validateMarkdown({ value }: { value: string }): string | undefined {
  return /^\s*# .+\n[\s\S]*\S/.test(value)
    ? undefined
    : 'Start with one H1 title and add content below it.';
}

export function KnowledgePageForm({
  initialValues,
  readableIdLocked = false,
  formId,
  pending,
  error,
  submitLabel,
  onSubmit,
}: KnowledgePageFormProps) {
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

  return (
    <form
      id={formId}
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="markdown"
          validators={{ onMount: validateMarkdown, onChange: validateMarkdown }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
              <span className="sr-only">Knowledge page content</span>
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
              <FieldDescription>
                Keep one coherent idea here. Type @ to mention an entity or reference a page; use H2
                or lower headings for linkable sections.
              </FieldDescription>
              {field.state.meta.isTouched && <FieldError>{field.state.meta.errors[0]}</FieldError>}
            </Field>
          )}
        </form.Field>

        {readableIdIssue && !readableIdLocked && (
          <form.Field
            name="readableId"
            validators={{ onMount: validateReadableId, onChange: validateReadableId }}
          >
            {(field) => (
              <ReadableIdField
                kind="page"
                value={field.state.value ?? ''}
                conflictingReadableId={conflictingReadableId}
                invalid={field.state.meta.errors.length > 0}
                error={
                  field.state.meta.isTouched ? field.state.meta.errors[0]?.toString() : undefined
                }
                onBlur={field.handleBlur}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        )}
      </FieldGroup>

      {error && !readableIdIssue && <FieldError>{error.message}</FieldError>}

      {submitLabel && (
        <form.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <Button
              className="justify-self-start"
              size="lg"
              type="submit"
              disabled={!canSubmit || pending}
            >
              {pending ? 'Saving…' : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      )}
    </form>
  );
}
