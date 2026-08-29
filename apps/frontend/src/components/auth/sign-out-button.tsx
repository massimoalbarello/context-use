import { useSignOut } from '../../lib/hooks/use-sign-out';

export function SignOutButton() {
  const { mutate, isPending } = useSignOut();

  return (
    <button
      type="button"
      onClick={() => mutate()}
      disabled={isPending}
      className="secondary-action min-h-8 px-3 py-1"
    >
      {isPending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
