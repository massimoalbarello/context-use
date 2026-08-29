import { useForm } from '@tanstack/react-form';

const READABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_DESCRIPTION_LENGTH = 20;

export type EntityFormValues = {
  readableId: string;
  name: string;
  description: string;
};

function validateReadableId({ value }: { value: string }): string | undefined {
  return READABLE_ID_PATTERN.test(value)
    ? undefined
    : 'Use lowercase words separated by single hyphens.';
}

function validateName({ value }: { value: string }): string | undefined {
  return value.trim() ? undefined : 'Give this entity a name.';
}

function validateDescription({ value }: { value: string }): string | undefined {
  return value.trim().length >= MIN_DESCRIPTION_LENGTH
    ? undefined
    : 'Add at least a short sentence that distinguishes this entity.';
}

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
        readableId: value.readableId.trim(),
        name: value.name.trim(),
        description: value.description.trim(),
      });
    },
  });

  return (
    <form
      className="surface grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="readableId"
        validators={{ onMount: validateReadableId, onChange: validateReadableId }}
      >
        {(field) => (
          <label className="field">
            <span>Readable ID</span>
            <input
              name={field.name}
              value={field.state.value}
              disabled={readableIdLocked}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
            />
            <small>
              Stable address:{' '}
              <code>context-use://entity/{field.state.value || 'luca-bianchi'}</code>
            </small>
            {field.state.meta.isTouched && field.state.meta.errors[0] && (
              <em role="alert">{field.state.meta.errors[0]}</em>
            )}
          </label>
        )}
      </form.Field>

      <form.Field name="name" validators={{ onMount: validateName, onChange: validateName }}>
        {(field) => (
          <label className="field">
            <span>Name</span>
            <input
              name={field.name}
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

      <form.Field
        name="description"
        validators={{ onMount: validateDescription, onChange: validateDescription }}
      >
        {(field) => (
          <label className="field">
            <span>Distinguishing description</span>
            <textarea
              name={field.name}
              rows={4}
              maxLength={600}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
            />
            <small>A few sentences at most: enough to tell this entity from namesakes.</small>
            {field.state.meta.isTouched && field.state.meta.errors[0] && (
              <em role="alert">{field.state.meta.errors[0]}</em>
            )}
          </label>
        )}
      </form.Field>

      {error && <p className="error-message">{error.message}</p>}

      <form.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <button
            className="primary-action justify-self-start"
            type="submit"
            disabled={!canSubmit || pending}
          >
            {pending ? 'Saving…' : submitLabel}
          </button>
        )}
      </form.Subscribe>
    </form>
  );
}
