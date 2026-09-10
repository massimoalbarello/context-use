import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createSqliteDatabase } from '#db/client.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { RecordsRepository } from '#repositories/records/repository.ts';
import { HypermediaSearchMaintenanceService } from '#services/hypermedia-retrieval/maintenance.ts';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    'data-folder': { type: 'string' },
    'owner-id': { type: 'string' },
    'after-page': { type: 'string' },
    'after-record': { type: 'string' },
  },
});
if (!values['data-folder'] || !values['owner-id']) {
  throw new Error(
    'Required: --data-folder <existing folder> --owner-id <owner>. Optional resume checkpoints: --after-page <readable ID> --after-record <readable ID>.',
  );
}
const dataFolder = resolve(values['data-folder']);
// This is maintenance of an existing, migrated database, never implicit bootstrap or startup work.
if (!(await Bun.file(join(dataFolder, 'app.db')).exists())) {
  throw new Error('The data folder must contain an existing app.db.');
}
const database = await createSqliteDatabase({ dataFolder });
try {
  const ownerId = values['owner-id'];
  const retrieval = new HypermediaRetrievalRepository(database);
  const maintenance = new HypermediaSearchMaintenanceService({
    retrieval,
    records: new RecordsRepository(database),
    pages: new KnowledgePagesRepository(database),
    storage: createLocalStorage({ dataFolder }),
  });
  await maintenance.rebuild({
    ownerId,
    afterPage: values['after-page'],
    afterRecord: values['after-record'],
    onProgress: (checkpoint) => console.info(JSON.stringify(checkpoint)),
  });
  console.info('Search projections rebuilt from current resources; index integrity verified.');
} finally {
  await database.close();
}
