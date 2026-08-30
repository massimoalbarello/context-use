import { useForm } from '@tanstack/react-form';
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
      <div className="entity-inline-fields">
        <p className="eyebrow">Entity {isSelf && <span className="self-badge">You</span>}</p>
        <form.Field
          name="name"
          validators={{ onMount: validateEntityName, onChange: validateEntityName }}
        >
          {(field) => (
            <label className="entity-inline-field">
              <span className="sr-only">Name</span>
              <input
                className="entity-name-input"
                name={field.name}
                value={field.state.value}
                maxLength={160}
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
            <label className="entity-inline-field">
              <span className="sr-only">Distinguishing description</span>
              <textarea
                className="entity-description-input"
                name={field.name}
                rows={1}
                maxLength={600}
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
      <div className="action-row entity-inline-actions">
        <button className="secondary-action" type="button" onClick={onCancel}>
          Cancel
        </button>
        <form.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <button className="primary-action" type="submit" disabled={!canSubmit || pending}>
              {pending ? 'Saving…' : 'Save identity'}
            </button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
