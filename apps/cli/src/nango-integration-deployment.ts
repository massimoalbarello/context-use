import { MANAGED_FUNCTIONS } from "../../../nango-integrations/catalog.ts";
import { sendSsmCommands } from "./aws.ts";
import { resolveSelectableIntegration, selectableIntegrations } from "./nango-integration-selection.ts";
import { nangoFunctionDeploymentCommands } from "./nango-integrations.ts";
import { readReleaseImages } from "./release-images.ts";
import type { DeploymentConfig } from "./types.ts";

type SendCommands = typeof sendSsmCommands;
type ReadImages = typeof readReleaseImages;

export type NangoIntegrationDeploymentDependencies = {
  sendCommands?: SendCommands;
  readImages?: ReadImages;
};

export type NangoFunctionDeploymentResult = {
  integrationId: string;
  functionName: string;
  output: string;
};

export type ManagedFunctionDeploymentOptions = {
  /** Deploy only these integrations. Defaults to every user-selectable one. */
  integrationIds?: readonly string[];
  allowDestructive?: boolean;
};

export async function deployManagedNangoFunctions(
  config: DeploymentConfig,
  deploymentRoot: string,
  instanceId: string,
  options: ManagedFunctionDeploymentOptions = {},
  dependencies: NangoIntegrationDeploymentDependencies = {},
): Promise<NangoFunctionDeploymentResult[]> {
  const sendCommands = dependencies.sendCommands ?? sendSsmCommands;
  const readImages = dependencies.readImages ?? readReleaseImages;
  const selected = new Set(
    (options.integrationIds ?? selectableIntegrations().map((integration) => integration.id))
      .map((id) => resolveSelectableIntegration(id).id),
  );
  const { nangoIntegrations } = await readImages(deploymentRoot);
  const deployerKeyParameter = `/context-use/${config.installationId}/${config.environment}/NANGO_DEPLOYER_API_KEY`;
  const results: NangoFunctionDeploymentResult[] = [];

  for (const managedFunction of MANAGED_FUNCTIONS.filter((candidate) => selected.has(candidate.integrationId))) {
    results.push(await deployFunction(
      config,
      instanceId,
      managedFunction.integrationId,
      managedFunction.name,
      nangoIntegrations,
      deployerKeyParameter,
      options.allowDestructive ?? false,
      sendCommands,
    ));
  }

  return results;
}

export async function deployManagedNangoFunction(
  config: DeploymentConfig,
  deploymentRoot: string,
  instanceId: string,
  integrationId: string,
  functionName: string,
  dependencies: NangoIntegrationDeploymentDependencies = {},
): Promise<NangoFunctionDeploymentResult> {
  const managed = MANAGED_FUNCTIONS.find(
    (candidate) => candidate.integrationId === integrationId && candidate.name === functionName,
  );
  if (!managed) throw new Error(`Unknown managed Nango function ${integrationId}/${functionName}`);
  const sendCommands = dependencies.sendCommands ?? sendSsmCommands;
  const { nangoIntegrations } = await (dependencies.readImages ?? readReleaseImages)(deploymentRoot);
  return deployFunction(
    config,
    instanceId,
    managed.integrationId,
    managed.name,
    nangoIntegrations,
    `/context-use/${config.installationId}/${config.environment}/NANGO_DEPLOYER_API_KEY`,
    false,
    sendCommands,
  );
}

async function deployFunction(
  config: DeploymentConfig,
  instanceId: string,
  integrationId: string,
  functionName: string,
  image: string,
  deployerKeyParameter: string,
  allowDestructive: boolean,
  sendCommands: SendCommands,
): Promise<NangoFunctionDeploymentResult> {
  const output = await sendCommands(
    config.awsProfile,
    config.awsRegion,
    instanceId,
    nangoFunctionDeploymentCommands({
      image,
      releaseVersion: config.releaseVersion,
      deployerKeyParameter,
      integrationId,
      syncName: functionName,
      allowDestructive,
    }),
  );
  return { integrationId, functionName, output };
}
