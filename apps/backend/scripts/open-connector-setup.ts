import { loadEnv } from '../src/lib/env.ts';
import { loadOpenConnectorSetupConfig } from '../src/lib/open-connector/config.ts';
import {
  configureOpenConnectorDestination,
  continueOpenConnectorAcquisition,
  startOpenConnectorBackfill,
} from '../src/lib/open-connector/setup-client.ts';
import {
  bindOpenConnectorTrustedOwner,
  recordOpenConnectorDeliveryApiKey,
  verifyOpenConnectorDeliveryApiKey,
} from './open-connector-local-binding.ts';

const FAILURE_EXIT_CODE = 1;
const OPERATIONS = ['register', 'backfill', 'continue'] as const;
type Operation = (typeof OPERATIONS)[number];

function usage(): string {
  return [
    'Usage: bun run open-connector:setup -- <register|backfill|continue>',
    '',
    '  register  Create or update the delivery destination and API key.',
    '  backfill  Start or restart the GitHub pull-request scan once.',
    '  continue  Continue the same acquisition without resetting its scan.',
  ].join('\n');
}

function operationFrom(arguments_: string[]): Operation | undefined {
  const [operation, ...unexpected] = arguments_;
  return unexpected.length === 0 && OPERATIONS.includes(operation as Operation)
    ? (operation as Operation)
    : undefined;
}

const operation = operationFrom(Bun.argv.slice(2));
if (!operation) {
  console.error(usage());
  process.exit(FAILURE_EXIT_CODE);
}

try {
  const env = loadEnv();
  const config = await loadOpenConnectorSetupConfig({ dataFolder: env.DATA_FOLDER });
  await bindOpenConnectorTrustedOwner({
    dataFolder: env.DATA_FOLDER,
    integrationId: config.integrationId,
    ownerId: config.ownerId,
  });
  if (operation === 'register') {
    await recordOpenConnectorDeliveryApiKey({
      dataFolder: env.DATA_FOLDER,
      integrationId: config.integrationId,
      ownerId: config.ownerId,
      deliveryApiKey: config.deliveryApiKey,
    });
    const destination = await configureOpenConnectorDestination({ config });
    console.log(`Configured open-connector delivery destination ${destination.url}.`);
  } else {
    await verifyOpenConnectorDeliveryApiKey({
      dataFolder: env.DATA_FOLDER,
      integrationId: config.integrationId,
      ownerId: config.ownerId,
      deliveryApiKey: config.deliveryApiKey,
    });
    const result =
      operation === 'backfill'
        ? await startOpenConnectorBackfill({ config })
        : await continueOpenConnectorAcquisition({ config });
    if (result.state === 'run_busy') {
      console.warn(
        'Open-connector already has an acquisition in progress. Its checkpoint was left unchanged; retry continue after that run finishes.',
      );
    } else if (!result.complete) {
      console.warn(
        `Open-connector committed ${result.records} records across ${result.pages} pages in run ${result.runId}, but the GitHub pull-request scan is incomplete. Run continue without backfill to resume the same checkpoint; the enabled scheduler may also continue it automatically.`,
      );
    } else if (operation === 'backfill') {
      console.log(
        `Open-connector completed the GitHub pull-request backfill in run ${result.runId} (${result.pages} pages, ${result.records} records).`,
      );
    } else {
      console.log(
        `Open-connector completed the GitHub pull-request scan in run ${result.runId} (${result.pages} pages, ${result.records} records).`,
      );
    }
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Open-connector setup failed unexpectedly.';
  console.error(message);
  process.exitCode = FAILURE_EXIT_CODE;
}
