import { join, resolve } from 'node:path';
import { createSqliteDatabase, createSynchronousSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import type { FaceAnalyzer } from '#backend/lib/face-analysis/analyzer.ts';
import { createLocalStorage } from '#backend/lib/storage/client.ts';
import { LocalStorage } from '#backend/lib/storage/local-storage.ts';
import type { EntityType } from '#backend/models/entities/model.ts';
import type { RecordInput } from '#backend/models/records/model.ts';
import { DEMO_OWNER_ID } from './identity';
import { createDemoResources } from './resources';

const FIXTURES = resolve(import.meta.dir, './fixtures');
type EntityFixture = {
  readableId: string;
  name: string;
  description: string;
  entityType?: EntityType;
};
type AssetFixture = {
  readableId: string;
  name: string;
  path: string;
  expectedMediaType?: string;
  entityReadableId?: string;
};
type RecordFixture = Omit<RecordInput, 'body'> & { path: string };
type PageFixture = { readableId: string; path: string; temporalCoverage: string | null };

function fixture(path: string) {
  return Bun.file(join(FIXTURES, path));
}

/** Build-time only: the published binary contains the resulting snapshot, not this seeder. */
export async function seedDemoSnapshot({
  dataFolder,
  analyzer,
}: {
  dataFolder: string;
  analyzer: FaceAnalyzer;
}) {
  const database = await createSqliteDatabase({ dataFolder });
  let facesDatabase: ReturnType<typeof createSynchronousSqliteDatabase> | undefined;
  let resources: Resources | undefined;
  try {
    await runMigrations({ db: database });
    facesDatabase = createSynchronousSqliteDatabase({ dataFolder });
    const now = new Date().toISOString();
    await database`INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (${DEMO_OWNER_ID}, 'Steve Jobs', 'steve-jobs@example.invalid', 0, ${now}, ${now})`;
    resources = createDemoResources({
      database,
      facesDatabase,
      storage: createLocalStorage({ dataFolder }),
      crops: new LocalStorage(join(dataFolder, 'face-crops')),
      analyzer,
    });
    const profile: EntityFixture = await fixture('entities/steve-jobs.json').json();
    const createdProfile = await resources.profilesService.create({
      change: { clientName: null, message: 'Added demo context' },
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
      const created = await resources.entitiesService.create({
        change: { clientName: null, message: 'Added demo context' },
        ownerId: DEMO_OWNER_ID,
        ...entity,
      });
      if (created.state !== 'created' || created.entity.readableId !== entity.readableId) {
        throw new Error(`Demo entity: ${entity.readableId}`);
      }
    }
    await seedAssets(resources);
    const recordAddresses = await seedRecords(resources);
    await seedPages({ resources, recordAddresses });
    await resources.facesService.close();
    resources = undefined;
    facesDatabase.close();
    facesDatabase = undefined;
    // A self-contained database without journals is safe to embed and open read-only.
    await database.unsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    await database.unsafe('PRAGMA journal_mode = DELETE');
  } finally {
    await resources?.facesService.close();
    facesDatabase?.close();
    await database.close();
  }
}

type Resources = ReturnType<typeof createDemoResources>;

async function seedAssets(resources: Resources) {
  const assets: AssetFixture[] = await fixture('assets/index.json').json();
  for (const asset of assets) {
    const created = await resources.assetsService.create({
      change: { clientName: null, message: 'Added demo context' },
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
        change: { clientName: null, message: 'Added demo context' },
        ownerId: DEMO_OWNER_ID,
        readableId: asset.entityReadableId,
        assetReadableId: asset.readableId,
      });
      if (updated.state !== 'updated') {
        throw new Error(`Demo entity image: ${asset.readableId}`);
      }
    }
  }

  // Portraits are all assigned before analysis, so normal enrollment also rematches earlier photos.
  for (const asset of assets) {
    const result = await resources.facesService.process({
      ownerId: DEMO_OWNER_ID,
      readableId: asset.readableId,
    });
    if (result?.state !== 'ready' && result?.state !== 'unsupported') {
      throw new Error(`Demo image ${asset.readableId}: ${result?.error ?? result?.state}`);
    }
  }
}

async function seedRecords(resources: Resources) {
  const fixtures: RecordFixture[] = await fixture('records/index.json').json();
  const addresses = new Map<string, string>();
  for (const { path, ...record } of fixtures) {
    const result = await resources.recordsService.upsert({
      change: { clientName: null, message: 'Added demo context' },
      ownerId: DEMO_OWNER_ID,
      record: { ...record, body: await fixture(path).text() },
    });
    if (result.state !== 'created') {
      throw new Error(`Demo record ${record.source.id}: ${result.state}`);
    }
    addresses.set(record.source.id, result.readableId);
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
      message: 'Curated demo knowledge',
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
