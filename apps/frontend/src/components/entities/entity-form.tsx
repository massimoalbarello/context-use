import { MAX_ENTITY_DESCRIPTION_LENGTH, MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { useForm } from '@tanstack/react-form';
import { ReadableIdConflictError, ReadableIdRequiredError } from '../../lib/api-error';
import { ReadableIdField, validateReadableId } from '../knowledge/readable-id-field';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { validateEntityDescription, validateEntityName } from './entity-validation';

export type EntityFormValues = {
  readableId?: string;
  name: string;
  description: string;
};

export function EntityForm({
  initialValues,
  readableIdLocked = false,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initialValues: EntityFormValues;
  readableIdLocked?: boolean;
  pending: boolean;
  error: Error | null;
  submitLabel: string;
  onSubmit: (values: EntityFormValues) => void;
}) {
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: ({ value }) => {
      onSubmit({
        readableId: value.readableId?.trim() || undefined,
        name: value.name.trim(),
        description: value.description.trim(),
      });
    },
  });
  const conflictingReadableId = error instanceof ReadableIdConflictError ? error.readableId : null;
  const readableIdIssue =
    error instanceof ReadableIdConflictError || error instanceof ReadableIdRequiredError;

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="name"
          validators={{ onMount: validateEntityName, onChange: validateEntityName }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor="entity-name">Name</FieldLabel>
              <Input
                id="entity-name"
                name={field.name}
                value={field.state.value}
                maxLength={MAX_ENTITY_NAME_LENGTH}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
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
                kind="entity"
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

        <form.Field
          name="description"
          validators={{
            onMount: validateEntityDescription,
            onChange: validateEntityDescription,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor="entity-description">Distinguishing description</FieldLabel>
              <Textarea
                id="entity-description"
                className="resize-y leading-relaxed"
                name={field.name}
                rows={4}
                maxLength={MAX_ENTITY_DESCRIPTION_LENGTH}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
              <FieldDescription>
                A few sentences at most: enough to tell this entity from namesakes.
              </FieldDescription>
              {field.state.meta.isTouched && <FieldError>{field.state.meta.errors[0]}</FieldError>}
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      {error && !readableIdIssue && <FieldError>{error.message}</FieldError>}

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
    </form>
  );
}
