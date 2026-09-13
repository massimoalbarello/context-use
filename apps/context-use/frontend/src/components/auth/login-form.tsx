import { Button } from '@repo/ui/button';
import { useLoginForm } from '../../lib/hooks/use-login-form';
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

      <Button type="submit" disabled={pending || !passkeysSupported} size="lg" className="w-full">
        {isSigningUp ? 'Create account with a passkey' : 'Sign in with a passkey'}
      </Button>
    </form>
  );
}
