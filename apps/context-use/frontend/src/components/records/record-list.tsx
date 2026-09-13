import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { ExternalRecordSummary } from '../../queries/records';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
import { RecordLink } from './record-link';

export function RecordList({
  records,
  filtered = false,
}: {
  records: ExternalRecordSummary[];
  filtered?: boolean;
}) {
  const activeRecordId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'records' ? resource.readableId : undefined;
    },
  });

  if (records.length === 0) {
    return (
      <ResourceListEmpty title={filtered ? 'No matching records.' : 'No synced records yet.'}>
        {filtered
          ? 'Clear or change the filters to see more records.'
          : 'Records appear here after an authorized sync delivers them.'}
      </ResourceListEmpty>
    );
  }

  return (
    <ResourceList>
      {records.map((record) => (
        <li key={record.readableId}>
          <RecordLink record={record} active={record.readableId === activeRecordId} />
        </li>
      ))}
    </ResourceList>
  );
}
