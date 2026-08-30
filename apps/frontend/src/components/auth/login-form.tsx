import { useLoginForm, validateName } from '../../lib/hooks/use-login-form';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';

export function LoginForm({
  ownerRegistered,
  redirectTo,
}: {
  ownerRegistered: boolean;
  redirectTo: string;
}) {
  const { api, isSigningUp, pending, error } = useLoginForm({ ownerRegistered, redirectTo });
  const passkeysSupported =
    window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined';

  return (
    <Card>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void api.handleSubmit();
          }}
        >
          <p className="text-muted-foreground text-sm leading-relaxed">
            {isSigningUp
              ? 'The first passkey created here becomes the owner of this Context Use instance.'
              : 'Use a passkey saved on this device, another device, or a security key.'}
          </p>

          <FieldGroup>
            {isSigningUp && (
              <api.Field name="name" validators={{ onChange: validateName }}>
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor="owner-name">Name</FieldLabel>
                    <Input
                      id="owner-name"
                      name={field.name}
                      type="text"
                      autoComplete="name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </Field>
                )}
              </api.Field>
            )}

            {!passkeysSupported && (
              <FieldError>Passkeys require a supported browser in a secure context.</FieldError>
            )}

            {error && <FieldError>{error.message}</FieldError>}
          </FieldGroup>

          <api.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Button
                type="submit"
                disabled={!canSubmit || pending || !passkeysSupported}
                size="lg"
                className="justify-self-start"
              >
                {isSigningUp ? 'Create account with a passkey' : 'Sign in with a passkey'}
              </Button>
            )}
          </api.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
