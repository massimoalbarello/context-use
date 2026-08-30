import { type ReactFormExtendedApi, useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useSignIn } from './use-sign-in';
import { useSignUp } from './use-sign-up';

export type LoginFormValues = {
  name: string;
};

export type LoginFormApi = ReactFormExtendedApi<
  LoginFormValues,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined
>;

export type LoginFormState = {
  api: LoginFormApi;
  isSigningUp: boolean;
  pending: boolean;
  error: Error | null;
};

const UNTOUCHED: LoginFormValues = {
  name: '',
};

export function validateName({ value }: { value: string }): string | undefined {
  return value.trim().length > 0 ? undefined : 'Tell us what to call you.';
}

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

  const api: LoginFormApi = useForm({
    defaultValues: UNTOUCHED,
    // `mutate` with a callback rather than `mutateAsync`: a rejected submit would leave
    // `handleSubmit` rejecting into nothing, and the mutation already carries the error.
    onSubmit: ({ value }) => {
      const onSuccess = async () => {
        if (isSigningUp) {
          await navigate({ to: '/setup', search: { redirect: redirectTo } });
          return;
        }
        await navigate({ href: redirectTo });
      };

      if (isSigningUp) {
        signUp.mutate({ name: value.name.trim() }, { onSuccess });
        return;
      }
      signIn.mutate(undefined, { onSuccess });
    },
  });

  return {
    api,
    isSigningUp,
    pending: mutation.isPending,
    error: mutation.error,
  };
}
