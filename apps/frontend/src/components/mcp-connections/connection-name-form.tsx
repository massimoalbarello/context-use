import { MAX_MCP_CONNECTION_NAME_LENGTH } from '@repo/backend/mcp-connection';
import { useForm } from '@tanstack/react-form';
import { type ReactNode, useId } from 'react';
import { submitThenChangeValidation } from '../../lib/form-validation';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

function validateName({ value }: { value: string }): string | undefined {
  const length = value.trim().length;
  if (length === 0) {
    return 'Enter a name for this connection.';
  }
  if (length > MAX_MCP_CONNECTION_NAME_LENGTH) {
    return `Use ${MAX_MCP_CONNECTION_NAME_LENGTH} characters or fewer.`;
  }
}

export function ConnectionNameForm({
  initialName,
  pending,
  error,
  formId,
  submitLabel,
  description,
  onSubmit,
  secondaryAction,
}: {
  initialName: string;
  pending: boolean;
  error: Error | null;
  formId?: string;
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
      className="grid gap-4"
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="name" validators={{ onDynamic: validateName }}>
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={nameInputId}>Connection name</FieldLabel>
            <Input
              id={nameInputId}
              name={field.name}
              value={field.state.value}
              maxLength={MAX_MCP_CONNECTION_NAME_LENGTH}
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
