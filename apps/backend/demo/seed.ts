import { join, resolve } from 'node:path';
import canonicalize from 'canonicalize';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import type { DeliveredRecord } from '#models/records/delivery-contract.generated.ts';
import { RecordSyncsRepository } from '#repositories/syncs/repository.ts';
import { RecordSyncsService } from '#services/syncs/service.ts';
import { DEMO_OWNER_ID } from './identity';
import { createDemoResources } from './resources';

const FIXTURES = resolve(import.meta.dir, '../../../scripts/seeds/isolated-development');
const RECORD_LIST_LIMIT = 50;
type EntityFixture = { readableId: string; name: string; description: string };
type AssetFixture = {
  readableId: string;
  name: string;
  path: string;
  expectedMediaType?: string;
  entityReadableId?: string;
};
type RecordFixture = Pick<DeliveredRecord, 'id' | 'provider' | 'kind'> & {
  path: string;
  content: Omit<Extract<DeliveredRecord, { operation: 'added' }>['content'], 'body'>;
};
type PageFixture = { readableId: string; path: string; temporalCoverage: string | null };

function fixture(path: string) {
  return Bun.file(join(FIXTURES, path));
}

/** Build-time only: the published binary contains the resulting snapshot, not this seeder. */
export async function seedDemoSnapshot({ dataFolder }: { dataFolder: string }) {
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    const now = new Date().toISOString();
    await database`INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${DEMO_OWNER_ID}, 'Steve Jobs', 'steve-jobs@example.invalid', 0, ${now}, ${now})`;
    const resources = createDemoResources({
      database,
      storage: createLocalStorage({ dataFolder }),
    });
    const profile: EntityFixture = await fixture('entities/steve-jobs.json').json();
    const createdProfile = await resources.profilesService.create({
      ownerId: DEMO_OWNER_ID,
      ...profile,
    });
    if (createdProfile.state !== 'created') {
      throw new Error(`Demo profile: ${createdProfile.state}`);
    }
    const entityFiles = Array.from(
      new Bun.Glob('entities/*.json').scanSync({ cwd: FIXTURES }),
    ).sort();
    for (const path of entityFiles) {
      const entity: EntityFixture = await fixture(path).json();
      if (entity.readableId === profile.readableId) {
        continue;
      }
      const created = await resources.entitiesService.create({ ownerId: DEMO_OWNER_ID, ...entity });
      if (created.state !== 'created' || created.entity.readableId !== entity.readableId) {
        throw new Error(`Demo entity: ${entity.readableId}`);
      }
    }
    await seedAssets(resources);
    const recordAddresses = await seedRecords({ resources, database });
    await seedPages({ resources, recordAddresses });
    // A self-contained database without journals is safe to embed and open read-only.
    await database.unsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await database.unsafe('PRAGMA journal_mode = DELETE');
  } finally {
    await database.close();
  }
}

type Resources = ReturnType<typeof createDemoResources>;

async function seedAssets(resources: Resources) {
  const assets: AssetFixture[] = await fixture('assets/index.json').json();
  for (const asset of assets) {
    const created = await resources.assetsService.create({
      ownerId: DEMO_OWNER_ID,
      name: asset.name,
      file: fixture(asset.path),
    });
    if (
      created.state !== 'created' ||
      created.asset.readableId !== asset.readableId ||
      (asset.expectedMediaType && created.asset.mediaType !== asset.expectedMediaType)
    ) {
      throw new Error(`Demo asset: ${asset.readableId}`);
    }
    if (asset.entityReadableId) {
      const updated = await resources.entitiesService.setImage({
        ownerId: DEMO_OWNER_ID,
        readableId: asset.entityReadableId,
        assetReadableId: asset.readableId,
      });
      if (updated.state !== 'updated') {
        throw new Error(`Demo entity image: ${asset.readableId}`);
      }
    }
  }
}

async function seedRecords({
  resources,
  database,
}: {
  resources: Resources;
  database: Awaited<ReturnType<typeof createSqliteDatabase>>;
}) {
  const syncs = new RecordSyncsService({ syncs: new RecordSyncsRepository(database) });
  const created = await syncs.create({
    actorId: DEMO_OWNER_ID,
    name: 'Steve Jobs historical research',
  });
  if (created.state !== 'created') {
    throw new Error(`Demo research sync: ${created.state}`);
  }
  const principal = await syncs.authenticate({ apiKey: created.apiKey });
  if (!principal) {
    throw new Error('Demo research sync could not be resolved');
  }
  const fixtures: RecordFixture[] = await fixture('records/index.json').json();
  const records: DeliveredRecord[] = await Promise.all(
    fixtures.map(async (record) => {
      const content = { ...record.content, body: await fixture(record.path).text() };
      return {
        eventId: Bun.randomUUIDv7(),
        provider: record.provider,
        sourceId: 'steve-jobs-ipod-iphone-2001-2007',
        kind: record.kind,
        id: record.id,
        revision: 1,
        operation: 'added',
        contentHash: new Bun.CryptoHasher('sha256').update(canonicalize(content)!).digest('hex'),
        committedAt: new Date().toISOString(),
        content,
      };
    }),
  );
  const result = await resources.recordsService.accept({
    ownerId: DEMO_OWNER_ID,
    syncId: principal.syncId,
    envelope: { version: 1, batchId: Bun.randomUUIDv7(), records },
  });
  if (result.state !== 'accepted') {
    throw new Error(`Demo records: ${result.state}`);
  }
  await syncs.revoke({ actorId: DEMO_OWNER_ID, readableId: created.sync.readableId });
  const addresses = new Map<string, string>();
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await resources.recordsService.listResources({
      ownerId: DEMO_OWNER_ID,
      limit: RECORD_LIST_LIMIT,
      offset,
    });
    for (const record of page.items) {
      addresses.set(record.recordId, record.readableId);
    }
    offset = page.nextOffset;
  }
  if (addresses.size !== fixtures.length) {
    throw new Error('Demo record import is incomplete');
  }
  return addresses;
}

async function seedPages({
  resources,
  recordAddresses,
}: {
  resources: Resources;
  recordAddresses: Map<string, string>;
}) {
  const snapshots: PageFixture[] = await fixture('pages/index.json').json();
  const revisions = new Map<string, number>();
  for (const snapshot of snapshots) {
    const markdown = (await fixture(snapshot.path).text()).replace(
      /context-use:\/\/record\/([a-z0-9-]+)/g,
      (reference) => {
        const id = reference.slice('context-use://record/'.length);
        const address = recordAddresses.get(id);
        if (!address) {
          throw new Error(`Demo record reference is unresolved: ${id}`);
        }
        return `context-use://record/${address}`;
      },
    );
    const input = {
      ownerId: DEMO_OWNER_ID,
      actor: { kind: 'owner' as const },
      markdown,
      temporalCoverage: snapshot.temporalCoverage,
    };
    const previous = revisions.get(snapshot.readableId);
    const result = previous
      ? await resources.pagesService.update({
          ...input,
          readableId: snapshot.readableId,
          expectedRevisionNumber: previous,
        })
      : await resources.pagesService.create(input);
    if (result.state !== 'saved' || result.page.readableId !== snapshot.readableId) {
      throw new Error(`Demo page ${snapshot.readableId}: ${result.state}`);
    }
    revisions.set(snapshot.readableId, result.page.revisionNumber);
  }
}
