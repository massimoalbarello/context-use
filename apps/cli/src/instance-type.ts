import { z } from "zod";

import { awsJson } from "./aws.ts";
import type { DeploymentConfig } from "./types.ts";

export const DEFAULT_INSTANCE_TYPE = "t3.large";
export const MINIMUM_INSTANCE_MEMORY_MIB = 4_096;
export const MINIMUM_INSTANCE_VCPUS = 2;

export const instanceTypeSchema = z.string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*\.[a-z0-9]+$/, "Enter an EC2 instance type such as t3a.medium");

export type InstanceTypeDetails = {
  InstanceType?: string;
  MemoryInfo?: { SizeInMiB?: number };
  ProcessorInfo?: { SupportedArchitectures?: string[] };
  VCpuInfo?: { DefaultVCpus?: number };
};

export function assertInstanceTypeDetails(instanceType: string, details: InstanceTypeDetails | undefined): void {
  if (!details || details.InstanceType !== instanceType) {
    throw new Error(`AWS did not return details for EC2 instance type ${instanceType}`);
  }
  if (!details.ProcessorInfo?.SupportedArchitectures?.includes("x86_64")) {
    throw new Error(`${instanceType} is not x86-64 compatible with the Context Use machine image`);
  }
  const vcpus = details.VCpuInfo?.DefaultVCpus ?? 0;
  if (vcpus < MINIMUM_INSTANCE_VCPUS) {
    throw new Error(
      `${instanceType} has ${vcpus} vCPU; Context Use requires at least ${MINIMUM_INSTANCE_VCPUS}`,
    );
  }
  const memoryMiB = details.MemoryInfo?.SizeInMiB ?? 0;
  if (memoryMiB < MINIMUM_INSTANCE_MEMORY_MIB) {
    throw new Error(
      `${instanceType} has ${memoryMiB} MiB RAM; Context Use requires at least ${MINIMUM_INSTANCE_MEMORY_MIB} MiB`,
    );
  }
}

export async function assertInstanceTypeSupported(
  config: Pick<DeploymentConfig, "awsProfile" | "awsRegion" | "availabilityZone">,
  instanceType: string,
): Promise<void> {
  const [catalog, offerings] = await Promise.all([
    awsJson<{ InstanceTypes?: InstanceTypeDetails[] }>(config.awsProfile, config.awsRegion, [
      "ec2", "describe-instance-types", "--instance-types", instanceType,
    ]),
    awsJson<{ InstanceTypeOfferings?: Array<{ InstanceType?: string }> }>(config.awsProfile, config.awsRegion, [
      "ec2", "describe-instance-type-offerings",
      "--location-type", "availability-zone",
      "--filters", `Name=instance-type,Values=${instanceType}`, `Name=location,Values=${config.availabilityZone}`,
    ]),
  ]);
  assertInstanceTypeDetails(instanceType, catalog.InstanceTypes?.[0]);
  if (!offerings.InstanceTypeOfferings?.some((offering) => offering.InstanceType === instanceType)) {
    throw new Error(`${instanceType} is not offered in ${config.availabilityZone}`);
  }
}
