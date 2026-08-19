import { describe, expect, test } from "bun:test";

import {
  assertInstanceTypeDetails,
  instanceTypeSchema,
  MINIMUM_INSTANCE_MEMORY_MIB,
  MINIMUM_INSTANCE_VCPUS,
} from "./instance-type.ts";

function details(overrides: {
  instanceType?: string;
  architectures?: string[];
  memoryMiB?: number;
  vcpus?: number;
} = {}) {
  return {
    InstanceType: overrides.instanceType ?? "t3a.medium",
    ProcessorInfo: { SupportedArchitectures: overrides.architectures ?? ["x86_64"] },
    MemoryInfo: { SizeInMiB: overrides.memoryMiB ?? MINIMUM_INSTANCE_MEMORY_MIB },
    VCpuInfo: { DefaultVCpus: overrides.vcpus ?? MINIMUM_INSTANCE_VCPUS },
  };
}

describe("instance type validation", () => {
  test("accepts a supported x86-64 instance at the minimum size", () => {
    expect(() => assertInstanceTypeDetails("t3a.medium", details())).not.toThrow();
  });

  test("rejects instance types below the memory floor", () => {
    expect(() => assertInstanceTypeDetails("t3a.small", details({
      instanceType: "t3a.small",
      memoryMiB: 2_048,
    }))).toThrow("requires at least 4096 MiB");
  });

  test("rejects instance types below the vCPU floor", () => {
    expect(() => assertInstanceTypeDetails("t2.small", details({
      instanceType: "t2.small",
      memoryMiB: 4_096,
      vcpus: 1,
    }))).toThrow("requires at least 2");
  });

  test("rejects Arm instance types until the machine image supports them", () => {
    expect(() => assertInstanceTypeDetails("t4g.medium", details({
      instanceType: "t4g.medium",
      architectures: ["arm64"],
    }))).toThrow("not x86-64 compatible");
  });

  test("validates EC2 instance type syntax", () => {
    expect(instanceTypeSchema.safeParse("t3a.medium").success).toBe(true);
    expect(instanceTypeSchema.safeParse("t3a.medium; reboot").success).toBe(false);
    expect(instanceTypeSchema.safeParse("not-an-instance").success).toBe(false);
  });
});
