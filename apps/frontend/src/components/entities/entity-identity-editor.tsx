import { MAX_ENTITY_DESCRIPTION_LENGTH, MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { useForm } from '@tanstack/react-form';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
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
      className="detail-header entity-inline-editor"
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
      <div className="entity-inline-fields">
        <form.Field
          name="name"
          validators={{ onMount: validateEntityName, onChange: validateEntityName }}
        >
          {(field) => (
            <label className="entity-inline-field" htmlFor="entity-name">
              <span className="sr-only">Name</span>
              <Input
                id="entity-name"
                className="entity-name-input"
                name={field.name}
                value={field.state.value}
                maxLength={MAX_ENTITY_NAME_LENGTH}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
              {field.state.meta.isTouched && field.state.meta.errors[0] && (
                <em role="alert">{field.state.meta.errors[0]}</em>
              )}
            </label>
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
            <label className="entity-inline-field" htmlFor="entity-description">
              <span className="sr-only">Distinguishing description</span>
              <Textarea
                id="entity-description"
                className="entity-description-input"
                name={field.name}
                rows={1}
                maxLength={MAX_ENTITY_DESCRIPTION_LENGTH}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
              {field.state.meta.isTouched && field.state.meta.errors[0] && (
                <em role="alert">{field.state.meta.errors[0]}</em>
              )}
            </label>
          )}
        </form.Field>
        {error && <p className="error-message">{error.message}</p>}
      </div>
    </form>
  );
}
