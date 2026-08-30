import { useLoginForm, validateName } from '../../lib/hooks/use-login-form';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
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

          {isSigningUp && (
            <api.Field name="name" validators={{ onChange: validateName }}>
              {(field) => (
                <label className="field" htmlFor="owner-name">
                  <span>Name</span>
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
                  {field.state.meta.errors[0] && <em role="alert">{field.state.meta.errors[0]}</em>}
                </label>
              )}
            </api.Field>
          )}

          {!passkeysSupported && (
            <p role="alert" className="error-message">
              Passkeys require a supported browser in a secure context.
            </p>
          )}

          {error && (
            <p role="alert" className="error-message">
              {error.message}
            </p>
          )}

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
