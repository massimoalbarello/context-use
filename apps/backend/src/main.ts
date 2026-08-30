import { createApp } from '#app.ts';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { createAuth } from '#lib/auth/better-auth.ts';
import { loadEnv } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '#pages/knowledge-page.ts';
import { EntitiesRepository } from '#repositories/entities.repository.ts';
import { FrontendAssetsRepository } from '#repositories/frontend-assets.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages.repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles.repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration.repository.ts';
import { EntitiesService } from '#services/entities.service.ts';
import { FrontendAssetsService } from '#services/frontend-assets.service.ts';
import { HealthService } from '#services/health.service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages.service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles.service.ts';
import { OwnerRegistrationService } from '#services/owner-registration.service.ts';

const BYTES_PER_KIBIBYTE = 1024;
const REQUEST_BODY_OVERHEAD_KIBIBYTES = 64;
const REQUEST_BODY_OVERHEAD_BYTES = REQUEST_BODY_OVERHEAD_KIBIBYTES * BYTES_PER_KIBIBYTE;

const env = loadEnv();
const database = await createSqliteDatabase({ dataFolder: env.DATA_FOLDER });

try {
  await runMigrations({ db: database });

  const storage = createLocalStorage({ dataFolder: env.DATA_FOLDER });
  const frontendAssetsService = new FrontendAssetsService(new FrontendAssetsRepository());
  const pagesRepository = new KnowledgePagesRepository(database);
  const entitiesService = new EntitiesService({
    entities: new EntitiesRepository(database),
    pages: pagesRepository,
  });
  const healthService = new HealthService(new HealthRepository(database));
  const ownerRegistrationService = new OwnerRegistrationService(
    new OwnerRegistrationRepository(database),
  );
  const pagesService = new KnowledgePagesService({ pages: pagesRepository, storage });
  const profilesService = new KnowledgeProfilesService(new KnowledgeProfilesRepository(database));
  const auth = createAuth({
    database,
    baseUrl: env.BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
  });

  const app = createApp({
    auth,
    frontendAssetsService,
    entitiesService,
    healthService,
    ownerRegistrationService,
    pagesService,
    profilesService,
  }).onStop(async () => {
    await database.close();
  });
  const { server } = app.listen({
    port: env.PORT,
    hostname: '0.0.0.0',
    maxRequestBodySize: MAX_KNOWLEDGE_PAGE_BYTES + REQUEST_BODY_OVERHEAD_BYTES,
  });

  createLogger('main').info(`listening on ${server!.url.origin}`);
} catch (error) {
  await database.close();
  throw error;
}
