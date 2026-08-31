import { createApp } from '#app.ts';
import { createSqliteDatabase } from '#db/client.ts';
import { runMigrations } from '#db/migrate.ts';
import { loadAuthSecret } from '#lib/auth/auth-secret.ts';
import { createAuth } from '#lib/auth/better-auth.ts';
import { loadEnv } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { BACKEND_ENVIRONMENT } from '#lib/runtime-config.ts';
import { createLocalStorage } from '#lib/storage/client.ts';
import { MAX_KNOWLEDGE_PAGE_BYTES } from '#models/knowledge-pages/model.ts';
import { EntitiesRepository } from '#repositories/entities/repository.ts';
import { FrontendAssetsRepository } from '#repositories/frontend-assets/repository.ts';
import { HealthRepository } from '#repositories/health/repository.ts';
import { KnowledgePagesRepository } from '#repositories/knowledge-pages/repository.ts';
import { KnowledgeProfilesRepository } from '#repositories/knowledge-profiles/repository.ts';
import { OwnerRegistrationRepository } from '#repositories/owner-registration/repository.ts';
import { EntitiesService } from '#services/entities/service.ts';
import { FrontendAssetsService } from '#services/frontend-assets/service.ts';
import { HealthService } from '#services/health/service.ts';
import { KnowledgePagesService } from '#services/knowledge-pages/service.ts';
import { KnowledgeProfilesService } from '#services/knowledge-profiles/service.ts';
import { OwnerRegistrationService } from '#services/owner-registration/service.ts';

const BYTES_PER_KIBIBYTE = 1024;
const REQUEST_BODY_OVERHEAD_KIBIBYTES = 64;
const REQUEST_BODY_OVERHEAD_BYTES = REQUEST_BODY_OVERHEAD_KIBIBYTES * BYTES_PER_KIBIBYTE;

const env = loadEnv();
const authSecret = await loadAuthSecret({
  dataFolder: env.DATA_FOLDER,
  environmentSecret: env.BETTER_AUTH_SECRET,
});
const logger = createLogger('main');
if (authSecret.source.kind === 'environment') {
  logger.info(`using auth secret from ${BACKEND_ENVIRONMENT.authSecret}`);
} else if (authSecret.source.kind === 'generated-file') {
  logger.info(`generated auth secret at ${authSecret.source.path}`);
} else {
  logger.info(`using auth secret from ${authSecret.source.path}`);
}
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
    secret: authSecret.value,
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

  logger.info(`listening on ${server!.url.origin}`);
} catch (error) {
  await database.close();
  throw error;
}
