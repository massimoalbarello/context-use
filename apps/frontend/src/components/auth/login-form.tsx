import { useLoginForm, validateName } from '../../lib/hooks/use-login-form';

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const { api, isSigningUp, setIsSigningUp, pending, error } = useLoginForm({ redirectTo });
  const passkeysSupported =
    window.isSecureContext && typeof window.PublicKeyCredential !== 'undefined';

  return (
    <form
      className="surface grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void api.handleSubmit();
      }}
    >
      <p className="text-muted text-sm leading-relaxed">
        {isSigningUp
          ? 'The first passkey created here becomes the owner of this Context Use instance.'
          : 'Use a passkey saved on this device, another device, or a security key.'}
      </p>

      {isSigningUp && (
        <api.Field name="name" validators={{ onChange: validateName }}>
          {(field) => (
            <label className="field">
              <span>Name</span>
              <input
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

      <div className="action-row">
        <api.Subscribe selector={(state) => state.canSubmit}>
          {(canSubmit) => (
            <button
              type="submit"
              disabled={!canSubmit || pending || !passkeysSupported}
              className="primary-action"
            >
              {isSigningUp ? 'Create account with a passkey' : 'Sign in with a passkey'}
            </button>
          )}
        </api.Subscribe>
        <button
          type="button"
          className="secondary-action"
          disabled={pending}
          onClick={() => setIsSigningUp(!isSigningUp)}
        >
          {isSigningUp ? 'Use an existing account' : 'Create the owner account'}
        </button>
      </div>
    </form>
  );
}
