import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { ExternalRecordSummary } from '../../queries/records';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
import { RecordLink } from './record-link';

export function RecordList({ records }: { records: ExternalRecordSummary[] }) {
  const activeRecordId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'records' ? resource.readableId : undefined;
    },
  });

  if (records.length === 0) {
    return (
      <ResourceListEmpty title="No synced records yet.">
        Records appear here after an external service is connected and delivers them.
      </ResourceListEmpty>
    );
  }

  return (
    <ResourceList className="gap-2">
      {records.map((record) => (
        <li key={record.readableId}>
          <RecordLink record={record} active={record.readableId === activeRecordId} />
        </li>
      ))}
    </ResourceList>
  );
}
