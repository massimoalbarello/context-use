import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { AssetSummary } from '../../queries/assets';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
import { AssetLink } from './asset-link';

export function AssetList({
  assets,
  filtered = false,
}: {
  assets: AssetSummary[];
  filtered?: boolean;
}) {
  const activeAssetId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'assets' ? resource.readableId : undefined;
    },
  });
  if (assets.length === 0) {
    return (
      <ResourceListEmpty title={filtered ? 'No assets match this search.' : 'No assets yet.'}>
        {filtered
          ? 'Clear or change the keyword search.'
          : 'Upload a file to embed it in or attach it to a knowledge page.'}
      </ResourceListEmpty>
    );
  }
  return (
    <ResourceList className="gap-2">
      {assets.map((asset) => (
        <li key={asset.readableId}>
          <AssetLink
            asset={asset}
            presentation="card"
            active={asset.readableId === activeAssetId}
          />
        </li>
      ))}
    </ResourceList>
  );
}
