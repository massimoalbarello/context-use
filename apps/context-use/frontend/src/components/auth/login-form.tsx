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
      {(!passkeysSupported || error) && (
        <FieldGroup>
          {!passkeysSupported && (
            <FieldError>Passkeys require a supported browser in a secure context.</FieldError>
          )}

          {error && (
            <FieldError className="wrap-anywhere whitespace-pre-line leading-relaxed">
              {error.message}
            </FieldError>
          )}
        </FieldGroup>
      )}

      <Button type="submit" disabled={pending || !passkeysSupported} size="lg" className="w-full">
        {isSigningUp ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  );
}
