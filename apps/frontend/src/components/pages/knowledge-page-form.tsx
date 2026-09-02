import {
  MAX_TEMPORAL_COVERAGE_LENGTH,
  parseTemporalCoverage,
} from '@repo/backend/temporal-coverage';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { submitThenChangeValidation } from '../../lib/form-validation';
import { useAssetSuggestions } from '../../lib/hooks/use-assets';
import { useEntitySuggestions } from '../../lib/hooks/use-entities';
import { usePageSuggestions } from '../../lib/hooks/use-pages';
import { temporalCoverageMutation } from '../../lib/temporal-coverage';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { KnowledgeLinkTextarea } from './knowledge-link-textarea';

export type KnowledgePageFormValues = {
  markdown: string;
  temporalCoverage: string | null;
};

type KnowledgePageFormSubmission = Omit<KnowledgePageFormValues, 'temporalCoverage'> & {
  temporalCoverage?: string | null;
  allowDuplicate?: boolean;
};

type KnowledgePageFormProps = {
  initialValues: KnowledgePageFormValues;
  pending: boolean;
  error: Error | null;
  onSubmit: (values: KnowledgePageFormSubmission) => void;
} & ({ submitLabel: string; formId?: never } | { formId: string; submitLabel?: never });

function validateMarkdown({ value }: { value: string }): string | undefined {
  return /^\s*# .+\n[\s\S]*\S/.test(value)
    ? undefined
    : 'Start with one H1 title and add content below it.';
}

function validateTemporalCoverage({ value }: { value: string }): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    parseTemporalCoverage(normalized);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Enter a supported subject time.';
  }
}

export function KnowledgePageForm({
  initialValues,
  formId,
  pending,
  error,
  submitLabel,
  onSubmit,
}: KnowledgePageFormProps) {
  const [knowledgeQuery, setKnowledgeQuery] = useState<string | null>(null);
  const { data: entitySuggestions = [] } = useEntitySuggestions(knowledgeQuery);
  const { data: pageSuggestions = [] } = usePageSuggestions(knowledgeQuery);
  const { data: assetSuggestions = [] } = useAssetSuggestions(knowledgeQuery);
  const form = useForm({
    defaultValues: {
      markdown: initialValues.markdown,
      temporalCoverage: initialValues.temporalCoverage ?? '',
      allowDuplicate: false,
    },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      const temporalCoverage = temporalCoverageMutation({
        initial: initialValues.temporalCoverage,
        current: value.temporalCoverage,
      });
      onSubmit({
        markdown: value.markdown.trim(),
        ...(temporalCoverage === undefined ? {} : { temporalCoverage }),
        allowDuplicate: value.allowDuplicate || undefined,
      });
    },
  });
  const duplicateTitle = error instanceof DuplicateResourceNameError;

  return (
    <form
      id={formId}
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        form.setFieldValue('allowDuplicate', false);
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="markdown" validators={{ onDynamic: validateMarkdown }}>
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <span className="sr-only">Knowledge page content</span>
              <KnowledgeLinkTextarea
                id={field.name}
                name={field.name}
                value={field.state.value}
                entities={entitySuggestions}
                pages={pageSuggestions}
                assets={assetSuggestions}
                invalid={field.state.meta.errors.length > 0}
                onBlur={field.handleBlur}
                onChange={field.handleChange}
                onQueryChange={setKnowledgeQuery}
              />
              <FieldDescription>
                Keep one coherent idea here. Type @ to mention an entity, reference a page, or use
                an asset; use H2 or lower headings for linkable sections.
              </FieldDescription>
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>
        <form.Field name="temporalCoverage" validators={{ onDynamic: validateTemporalCoverage }}>
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor={field.name}>Subject time (optional)</FieldLabel>
                {field.state.value && (
                  <Button
                    className="h-auto px-0 py-0 text-xs"
                    type="button"
                    variant="link"
                    onClick={() => field.handleChange('')}
                  >
                    Clear subject time
                  </Button>
                )}
              </div>
              <Input
                id={field.name}
                name={field.name}
                maxLength={MAX_TEMPORAL_COVERAGE_LENGTH}
                placeholder="2025-03/2025-08"
                value={field.state.value}
                aria-invalid={field.state.meta.errors.length > 0}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldDescription>
                When the page’s subject occurred or applied—for example 2025, 2025-03~, 2025-03-14?,
                or 2025-03/...
              </FieldDescription>
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      {error && <FieldError>{error.message}</FieldError>}

      {submitLabel && (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="justify-self-start" size="lg" type="submit" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
          {duplicateTitle && (
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={() => {
                form.setFieldValue('allowDuplicate', true);
                void form.handleSubmit();
              }}
            >
              Use this title anyway
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
