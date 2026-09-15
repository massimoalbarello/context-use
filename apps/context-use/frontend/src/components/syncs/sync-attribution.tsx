import type { RecordSync } from '../../queries/syncs';
import { Badge } from '../ui/badge';

export function SyncAttribution({ sync }: { sync: Pick<RecordSync, 'name'> | null }) {
  return <Badge variant="secondary">{sync ? `Synced by ${sync.name}` : 'Synced'}</Badge>;
}
