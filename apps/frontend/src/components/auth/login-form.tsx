import { useLoginForm } from '../../lib/hooks/use-login-form';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { FieldError, FieldGroup } from '../ui/field';

export function LoginForm({
  ownerRegistered,
  redirectTo,
}: {
  ownerRegistered: boolean;
  redirectTo: string;
}) {
  const { isSigningUp, pending, error, submit } = useLoginForm({
    ownerRegistered,
    redirectTo,
  });
  const passkeysSupported =
    window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined';

  return (
    <Card>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="text-muted-foreground text-sm leading-relaxed">
            {isSigningUp
              ? 'The first passkey created here becomes the owner of this Context Use instance.'
              : 'Use a passkey saved on this device, another device, or a security key.'}
          </p>

          {(!passkeysSupported || error) && (
            <FieldGroup>
              {!passkeysSupported && (
                <FieldError>Passkeys require a supported browser in a secure context.</FieldError>
              )}

              {error && <FieldError>{error.message}</FieldError>}
            </FieldGroup>
          )}

          <Button
            type="submit"
            disabled={pending || !passkeysSupported}
            size="lg"
            className="justify-self-start"
          >
            {isSigningUp ? 'Create account with a passkey' : 'Sign in with a passkey'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
