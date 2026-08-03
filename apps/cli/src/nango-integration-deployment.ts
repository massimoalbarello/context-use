import { MANAGED_FUNCTIONS } from "../../../nango-integrations/catalog.ts";
import { sendSsmCommands } from "./aws.ts";
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

export async function deployManagedNangoFunctions(
  config: DeploymentConfig,
  deploymentRoot: string,
  instanceId: string,
  allowDestructive = false,
  dependencies: NangoIntegrationDeploymentDependencies = {},
): Promise<NangoFunctionDeploymentResult[]> {
  const sendCommands = dependencies.sendCommands ?? sendSsmCommands;
  const readImages = dependencies.readImages ?? readReleaseImages;
  const { nangoIntegrations } = await readImages(deploymentRoot);
  const deployerKeyParameter = `/context-use/${config.installationId}/${config.environment}/NANGO_DEPLOYER_API_KEY`;
  const results: NangoFunctionDeploymentResult[] = [];

  for (const managedFunction of MANAGED_FUNCTIONS) {
    const output = await sendCommands(
      config.awsProfile,
      config.awsRegion,
      instanceId,
      nangoFunctionDeploymentCommands({
        image: nangoIntegrations,
        releaseVersion: config.releaseVersion,
        deployerKeyParameter,
        integrationId: managedFunction.integrationId,
        syncName: managedFunction.name,
        allowDestructive,
      }),
    );
    results.push({
      integrationId: managedFunction.integrationId,
      functionName: managedFunction.name,
      output,
    });
  }

  return results;
}
