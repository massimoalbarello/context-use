import { Button } from '@repo/ui/button';
import { useSignOut } from '../../lib/hooks/use-sign-out';

export function SignOutButton() {
  const { mutate, isPending } = useSignOut();

  return (
    <Button type="button" onClick={() => mutate()} disabled={isPending} variant="ghost" size="sm">
      {isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
