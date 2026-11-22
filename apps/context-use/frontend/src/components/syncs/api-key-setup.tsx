import { Button } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import { useId } from 'react';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

export function ApiKeySetup(input: {
  providerName: string;
  setupUrl: string;
  connected: boolean;
  pending: boolean;
  error: Error | null;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const id = useId();
  const form = useForm({
    defaultValues: { apiKey: '' },
    onSubmit: async ({ value }) => {
      try {
        await input.onSave(value.apiKey.trim());
      } finally {
        form.reset();
      }
    },
  });
  return (
    <form
      className="grid max-w-xl gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => {});
      }}
    >
      <ResourceDetailHeading actions={null}>API key</ResourceDetailHeading>
      <p className="text-muted-foreground text-sm">
        In {input.providerName}, open Settings → Connectors → API keys and create a key with
        Personal notes access.{' '}
        <a href={input.setupUrl} target="_blank" rel="noreferrer" className="underline">
          API key instructions
        </a>
      </p>
      {input.connected && <p>API key saved. Enter a new key to replace it.</p>}
      <form.Field
        name="apiKey"
        validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Enter your API key.') }}
      >
        {(field) => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={id}>API key</FieldLabel>
            <Input
              id={id}
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              disabled={input.pending}
            />
            <FieldError>{field.state.meta.errors[0]}</FieldError>
          </Field>
        )}
      </form.Field>
      {input.error && (
        <p role="alert" className="text-destructive text-sm">
          {input.error.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={input.pending}>
          Save API key
        </Button>
      </div>
    </form>
  );
}
