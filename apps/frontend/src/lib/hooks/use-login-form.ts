import { useNavigate } from '@tanstack/react-router';
import { useSignIn } from './use-sign-in';
import { useSignUp } from './use-sign-up';

export type LoginFormState = {
  isSigningUp: boolean;
  pending: boolean;
  error: Error | null;
  submit: () => void;
};

export function useLoginForm({
  ownerRegistered,
  redirectTo,
}: {
  ownerRegistered: boolean;
  redirectTo: string;
}): LoginFormState {
  const navigate = useNavigate();
  const isSigningUp = !ownerRegistered;
  const signIn = useSignIn();
  const signUp = useSignUp();
  const mutation = isSigningUp ? signUp : signIn;

  const submit = () => {
    const onSuccess = async () => {
      if (isSigningUp) {
        await navigate({ to: '/setup', search: { redirect: redirectTo } });
        return;
      }
      await navigate({ href: redirectTo });
    };

    if (isSigningUp) {
      signUp.mutate(undefined, { onSuccess });
      return;
    }
    signIn.mutate(undefined, { onSuccess });
  };

  return {
    isSigningUp,
    pending: mutation.isPending,
    error: mutation.error,
    submit,
  };
}
