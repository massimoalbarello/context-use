import { useSignOut } from '../../lib/hooks/use-sign-out';
import { Button } from '../ui/button';

export function SignOutButton() {
  const { mutate, isPending } = useSignOut();

  return (
    <Button type="button" onClick={() => mutate()} disabled={isPending} variant="ghost" size="sm">
      {isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
