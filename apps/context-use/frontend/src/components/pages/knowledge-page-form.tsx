import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import type { ComponentProps, ReactNode, SyntheticEvent } from 'react';
import { MAX_CHANGE_MESSAGE_LENGTH } from '#backend/models/history/model.ts';
import {
  InvalidKnowledgePageMarkdownError,
  parseKnowledgePageWriteMarkdown,
} from '#backend/models/knowledge-pages/markdown.ts';
import {
  MAX_TEMPORAL_COVERAGE_LENGTH,
  parseTemporalCoverage,
} from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { submitThenChangeValidation } from '../../lib/form-validation';
import { temporalCoverageExpression, temporalCoverageMutation } from '../../lib/temporal-coverage';
import type { CreatePageVariables, KnowledgePage } from '../../queries/pages';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

const NEW_PAGE = { markdown: '# A focused idea\n\n', temporalCoverage: null };

export type MarkdownInputProps = {
  id: string;
  name: string;
  value: string;
  invalid: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
};

type PageFormLayout = {
  initialValues?: Pick<KnowledgePage, 'markdown' | 'temporalCoverage'>;
  pending: boolean;
  header: (slots: { intervalField: ReactNode; actions: ReactNode }) => ReactNode;
  onSubmit: (values: CreatePageVariables) => void;
} & ({ submitLabel: string; onCancel?: never } | { onCancel: () => void; submitLabel?: never });

type PageFormProps = PageFormLayout & {
  error: ReactNode;
  duplicateTitle?: boolean;
  submitDisabled?: boolean;
  markdownInput: (props: MarkdownInputProps) => ReactNode;
};

function validateMarkdown({ value }: { value: string }): string | undefined {
  try {
    parseKnowledgePageWriteMarkdown(value.trim());
    return undefined;
  } catch (error) {
    if (error instanceof InvalidKnowledgePageMarkdownError) {
      return error.message;
    }
    throw error;
  }
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
    return error instanceof Error ? error.message : 'Enter a supported interval.';
  }
}

export function KnowledgePageForm({
  initialValues = NEW_PAGE,
  onCancel,
  pending,
  error,
  duplicateTitle,
  submitDisabled,
  markdownInput,
  header,
  submitLabel,
  onSubmit,
}: PageFormProps) {
  const initialInterval = initialValues.temporalCoverage
    ? temporalCoverageExpression(initialValues.temporalCoverage)
    : null;
  const form = useForm({
    defaultValues: {
      markdown: initialValues.markdown,
      temporalCoverage: initialInterval ?? '',
      allowDuplicate: false,
      changeMessage: '',
    },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      const temporalCoverage = temporalCoverageMutation({
        initial: initialInterval,
        current: value.temporalCoverage,
      });
      return onSubmit({
        markdown: value.markdown.trim(),
        changeMessage: value.changeMessage.trim() || undefined,
        ...(temporalCoverage === undefined ? {} : { temporalCoverage }),
        allowDuplicate: value.allowDuplicate || undefined,
      });
    },
  });
  const intervalField = (
    <form.Field name="temporalCoverage" validators={{ onDynamic: validateTemporalCoverage }}>
      {(field) => (
        <Field className="w-56 gap-1" data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel className="sr-only" htmlFor={field.name}>
            Interval (optional)
          </FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              className="rounded-full bg-muted/55"
              id={field.name}
              name={field.name}
              disabled={pending}
              maxLength={MAX_TEMPORAL_COVERAGE_LENGTH}
              placeholder="Add interval"
              value={field.state.value}
              aria-describedby={`${field.name}-help`}
              aria-invalid={field.state.meta.errors.length > 0}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {field.state.value && (
              <Button
                className="h-auto shrink-0 px-0 py-0 text-xs"
                type="button"
                disabled={pending}
                variant="link"
                onClick={() => field.handleChange('')}
              >
                Clear
              </Button>
            )}
          </div>
          <FieldDescription className="sr-only" id={`${field.name}-help`}>
            Add when the page's subject occurred or applied, such as 2025 or 2025-03/2025-08. Leave
            blank when no useful interval is known.
          </FieldDescription>
          <FieldError>{field.state.meta.errors[0]}</FieldError>
        </Field>
      )}
    </form.Field>
  );

  function save(allowDuplicate: boolean) {
    if (pending || submitDisabled) {
      return;
    }
    form.setFieldValue('allowDuplicate', allowDuplicate);
    void form.handleSubmit();
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    save(false);
  }

  return (
    <form className="grid gap-5" onSubmit={submit}>
      {header({
        intervalField,
        actions: onCancel && (
          <ResourceDetailActions
            mode="edit"
            resource="page"
            pending={pending}
            saveDisabled={submitDisabled}
            onCancel={onCancel}
            onSaveClick={submit}
          />
        ),
      })}
      <FieldGroup>
        <form.Field name="markdown" validators={{ onDynamic: validateMarkdown }}>
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              {markdownInput({
                id: field.name,
                name: field.name,
                value: field.state.value,
                invalid: field.state.meta.errors.length > 0,
                onBlur: field.handleBlur,
                onChange: field.handleChange,
              })}
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>
        <form.Field name="changeMessage">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="page-change-message">Change summary (optional)</FieldLabel>
              <Input
                id="page-change-message"
                value={field.state.value}
                disabled={pending}
                maxLength={MAX_CHANGE_MESSAGE_LENGTH}
                placeholder="What changed and why?"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldDescription>Shown in History alongside the changes.</FieldDescription>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      {error && <FieldError>{error}</FieldError>}

      {(submitLabel || duplicateTitle) && (
        <div className="flex flex-wrap items-center gap-3">
          {submitLabel && (
            <Button
              className="justify-self-start"
              size="lg"
              type="submit"
              onClick={submit}
              disabled={pending || submitDisabled}
            >
              {pending ? 'Saving…' : submitLabel}
            </Button>
          )}
          {duplicateTitle && (
            <Button
              variant="outline"
              type="button"
              disabled={pending || submitDisabled}
              onClick={() => save(true)}
            >
              Use this title anyway
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

export function PageMarkdownTextarea(props: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      rows={12}
      spellCheck
      className="block min-h-64 resize-y font-mono leading-relaxed md:min-h-72"
      {...props}
    />
  );
}
