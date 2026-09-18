import { Button, buttonVariants } from '@repo/ui/button';
import { useForm } from '@tanstack/react-form';
import { ArrowUpRight } from 'lucide-react';
import { useId, useState } from 'react';
import { submitThenChangeValidation } from '../../lib/form-validation';
import type { OAuthAppCredentials } from '../../queries/managed-syncs';
import { CopyableValue } from '../copyable-value';
import { ResourceDetailActions } from '../knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { Field, FieldError, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

export function OAuthAppSetup(input: {
  providerName: string;
  createAppUrl: string;
  callbackUrl: string;
  configured: boolean;
  pending: boolean;
  error: Error | null;
  onSave: (credentials: OAuthAppCredentials) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<'create' | 'credentials'>(
    input.configured ? 'credentials' : 'create',
  );
  const fieldId = useId();
  const form = useForm({
    defaultValues: { clientId: '', clientSecret: '' },
    validationLogic: submitThenChangeValidation,
    onSubmit: ({ value }) => {
      input.onSave({ clientId: value.clientId.trim(), clientSecret: value.clientSecret.trim() });
      form.reset();
    },
  });
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <ResourceDetailHeading
        actions={
          step === 'credentials' ? (
            <ResourceDetailActions
              mode="edit"
              resource="OAuth app"
              pending={input.pending}
              onCancel={input.onCancel}
            />
          ) : (
            <Button type="button" variant="outline" size="lg" onClick={input.onCancel}>
              Cancel
            </Button>
          )
        }
      >
        OAuth app
      </ResourceDetailHeading>
      <div className="grid max-w-xl gap-5">
        {step === 'create' ? (
          <>
            <p className="text-muted-foreground text-sm">
              Create an OAuth app in your {input.providerName} account. Name it Context Use and copy
              these URLs into the matching fields.
            </p>
            <CopyableValue label="Homepage URL" value={new URL('/', input.callbackUrl).href} />
            <CopyableValue label="Authorization callback URL" value={input.callbackUrl} />
            <a
              href={input.createAppUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
            >
              Create OAuth app on {input.providerName} <ArrowUpRight aria-hidden="true" />
            </a>
            <div>
              <Button type="button" onClick={() => setStep('credentials')}>
                I have an OAuth app
              </Button>
            </div>
          </>
        ) : (
          <>
            {(['clientId', 'clientSecret'] as const).map((name) => (
              <form.Field
                key={name}
                name={name}
                validators={{
                  onDynamic: ({ value }) =>
                    value.trim()
                      ? undefined
                      : `Enter your ${name === 'clientId' ? 'client ID' : 'client secret'}.`,
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor={`${fieldId}-${name}`}>
                      {name === 'clientId' ? 'Client ID' : 'Client secret'}
                    </FieldLabel>
                    <Input
                      id={`${fieldId}-${name}`}
                      name={name}
                      type={name === 'clientSecret' ? 'password' : 'text'}
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
            ))}
            {input.error && (
              <p role="alert" className="text-destructive text-sm">
                {input.error.message}
              </p>
            )}
            <div>
              <Button
                type="button"
                variant="ghost"
                disabled={input.pending}
                onClick={() => setStep('create')}
              >
                Setup instructions
              </Button>
            </div>
          </>
        )}
      </div>
    </form>
  );
}
