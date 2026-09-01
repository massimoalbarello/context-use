import { MAX_MCP_CLIENT_NAME_LENGTH } from '@repo/backend/mcp-client-authorization';
import { useForm } from '@tanstack/react-form';
import { type ReactNode, useId } from 'react';
import { submitThenChangeValidation } from '../../lib/form-validation';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

function validateName({ value }: { value: string }): string | undefined {
  const length = value.trim().length;
  if (length === 0) {
    return 'Enter a name for this client.';
  }
  if (length > MAX_MCP_CLIENT_NAME_LENGTH) {
    return `Use ${MAX_MCP_CLIENT_NAME_LENGTH} characters or fewer.`;
  }
}

export function ClientNameForm({
  initialName,
  pending,
  error,
  formId,
  presentation = 'field',
  submitLabel,
  description,
  onSubmit,
  secondaryAction,
}: {
  initialName: string;
  pending: boolean;
  error: Error | null;
  formId?: string;
  presentation?: 'field' | 'card-title';
  submitLabel?: string;
  description?: string;
  onSubmit: (name: string) => void;
  secondaryAction?: ReactNode;
}) {
  const nameInputId = useId();
  const form = useForm({
    defaultValues: { name: initialName },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => onSubmit(value.name.trim()),
  });

  return (
    <form
      className={presentation === 'card-title' ? 'grid w-full min-w-0 flex-1 gap-4' : 'grid gap-4'}
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onDynamic: validateName }}>
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel
              className={presentation === 'card-title' ? 'sr-only' : undefined}
              htmlFor={nameInputId}
            >
              Client name
            </FieldLabel>
            <Input
              className={
                presentation === 'card-title'
                  ? '-mx-2 h-auto w-[calc(100%+1rem)] px-2 py-0 font-semibold text-base text-foreground md:text-base'
                  : undefined
              }
              id={nameInputId}
              name={field.name}
              value={field.state.value}
              maxLength={MAX_MCP_CLIENT_NAME_LENGTH}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            {description && <FieldDescription>{description}</FieldDescription>}
            <FieldError>{field.state.meta.errors[0]}</FieldError>
          </Field>
        )}
      </form.Field>
      {error && <FieldError>{error.message}</FieldError>}
      {(submitLabel || secondaryAction) && (
        <div className="flex flex-wrap items-center gap-3">
          {submitLabel && (
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? 'Saving…' : submitLabel}
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
    </form>
  );
}
