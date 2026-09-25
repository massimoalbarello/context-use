import { Route } from '../../routes/app';
import type { Session } from '../auth';

export function useSession(): Session | null {
  const { session } = Route.useRouteContext();
  return session;
}
