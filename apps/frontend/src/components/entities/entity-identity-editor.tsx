import { MAX_ENTITY_DESCRIPTION_LENGTH, MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { useForm } from '@tanstack/react-form';
import { submitThenChangeValidation } from '../../lib/form-validation';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { ResourceNameInput } from '../knowledge/resource-name';
import { Badge } from '../ui/badge';
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Textarea } from '../ui/textarea';
import { validateEntityDescription, validateEntityName } from './entity-validation';

export function EntityIdentityEditor({
  name,
  description,
  isSelf,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  name: string;
  description: string;
  isSelf: boolean;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (identity: { name: string; description: string }) => void;
}) {
  const form = useForm({
    defaultValues: { name, description },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) =>
      onSubmit({ name: value.name.trim(), description: value.description.trim() }),
  });

  return (
    <form
      className="grid w-full gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <ResourceDetailHeading
        actions={
          <ResourceDetailActions
            mode="edit"
            resource="entity"
            pending={pending}
            onCancel={onCancel}
          />
        }
      >
        Entity {isSelf && <Badge variant="secondary">You</Badge>}
      </ResourceDetailHeading>
      <FieldGroup className="w-full min-w-0 max-w-3xl gap-0">
        <form.Field name="name" validators={{ onDynamic: validateEntityName }}>
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel className="sr-only" htmlFor="entity-name">
                Name
              </FieldLabel>
              <ResourceNameInput
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
              <FieldLabel className="sr-only" htmlFor="entity-description">
                Distinguishing description
              </FieldLabel>
              <Textarea
                id="entity-description"
                className="-mx-2 mt-3 max-h-40 min-h-[1lh] w-[calc(100%+1rem)] resize-y px-2 py-0 text-lg text-muted-foreground leading-relaxed"
                name={field.name}
                rows={1}
                maxLength={MAX_ENTITY_DESCRIPTION_LENGTH}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError>{field.state.meta.errors[0]}</FieldError>
            </Field>
          )}
        </form.Field>
        {error && <FieldError>{error.message}</FieldError>}
      </FieldGroup>
    </form>
  );
}
