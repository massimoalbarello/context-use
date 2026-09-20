import { getOpenSyncBuildOptions, providersFromDefinitions } from '@context-use/open-sync/build';
import { SyncCatalog } from '../../src/services/syncs/catalog.ts';
import { syncProviders } from '../../src/services/syncs/providers/index.ts';

export function prepareSyncBuild() {
  return getOpenSyncBuildOptions({
    providers: providersFromDefinitions(new SyncCatalog(syncProviders).definitions),
  });
}
