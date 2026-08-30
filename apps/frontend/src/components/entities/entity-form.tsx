import { MAX_ENTITY_DESCRIPTION_LENGTH, MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { useForm } from '@tanstack/react-form';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { submitThenChangeValidation } from '../../lib/form-validation';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { validateEntityDescription, validateEntityName } from './entity-validation';

export type EntityFormValues = {
  name: string;
  description: string;
};

type EntityFormSubmission = EntityFormValues & { allowDuplicate?: boolean };

export function EntityForm({
  initialValues,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  initialValues: EntityFormValues;
  pending: boolean;
  error: Error | null;
  submitLabel: string;
  onSubmit: (values: EntityFormSubmission) => void;
}) {
  const form = useForm({
    defaultValues: { ...initialValues, allowDuplicate: false },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      onSubmit({
        name: value.name.trim(),
        description: value.description.trim(),
        allowDuplicate: value.allowDuplicate || undefined,
      });
    },
  });
  const duplicateName = error instanceof DuplicateResourceNameError;

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        form.setFieldValue('allowDuplicate', false);
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="name" validators={{ onDynamic: validateEntityName }}>
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor="entity-name">Name</FieldLabel>
              <Input
                id="entity-name"
                name={field.name}
                value={field.state.value}
                maxLength={MAX_ENTITY_NAME_LENGTH}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>

        <form.Field
          name="description"
          validators={{
            onDynamic: validateEntityDescription,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
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
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldDescription>
                A few sentences at most: enough to tell this entity from namesakes.
              </FieldDescription>
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      {error && <FieldError>{error.message}</FieldError>}

      <div className="flex flex-wrap items-center gap-3">
        <Button className="justify-self-start" size="lg" type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {duplicateName && (
          <Button
            variant="outline"
            type="button"
            disabled={pending}
            onClick={() => {
              form.setFieldValue('allowDuplicate', true);
              void form.handleSubmit();
            }}
          >
            Use this name anyway
          </Button>
        )}
      </div>
    </form>
  );
}
