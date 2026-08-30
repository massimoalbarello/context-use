import { MAX_ENTITY_DESCRIPTION_LENGTH, MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { useForm } from '@tanstack/react-form';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
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
          <>
            <Button variant="outline" size="lg" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state.canSubmit}>
              {(canSubmit) => (
                <Button size="lg" type="submit" disabled={!canSubmit || pending}>
                  {pending ? 'Saving…' : 'Save entity'}
                </Button>
              )}
            </form.Subscribe>
          </>
        }
      >
        Entity {isSelf && <Badge variant="secondary">You</Badge>}
      </ResourceDetailHeading>
      <FieldGroup className="w-full min-w-0 max-w-3xl gap-0">
        <form.Field
          name="name"
          validators={{ onMount: validateEntityName, onChange: validateEntityName }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
              <FieldLabel className="sr-only" htmlFor="entity-name">
                Name
              </FieldLabel>
              <Input
                id="entity-name"
                className="-mx-2 mt-2 h-auto w-[calc(100%+1rem)] px-2 py-0 font-semibold text-4xl text-foreground tracking-tight md:text-5xl"
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
        <form.Field
          name="description"
          validators={{
            onMount: validateEntityDescription,
            onChange: validateEntityDescription,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
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
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
              {field.state.meta.isTouched && <FieldError>{field.state.meta.errors[0]}</FieldError>}
            </Field>
          )}
        </form.Field>
        {error && <FieldError>{error.message}</FieldError>}
      </FieldGroup>
    </form>
  );
}
