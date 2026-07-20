export type DataOutputs = {
  kms_key_arn: string;
  kms_key_id: string;
  data_volume_id: string;
  asset_bucket: string;
  backup_bucket: string;
};

export type ComputeOutputs = {
  instance_id: string;
  public_ip: string;
  app_url: string;
  asset_url: string;
  public_mcp_url: string;
  cloudwatch_log_group: string;
};

export type RecoveryIntent = {
  backupKey: string;
  previousVolumeId: string;
};

export type DeploymentConfig = {
  schemaVersion: 2;
  releaseVersion: string;
  environment: string;
  installationId: string;
  awsProfile: string;
  awsRegion: string;
  availabilityZone: string;
  accountId: string;
  hostname: string;
  assetHostname: string;
  publicMcpHostname: string;
  dnsMode: "route53" | "manual";
  route53ZoneId: string;
  ownerEmail: string;
  stateBucket: string;
  legacyStateKmsKeyArn?: string;
  instanceType: string;
  dataVolumeSizeGb: number;
  backupRetentionDays: number;
  recovery?: RecoveryIntent;
};

export type ReleaseManifest = {
  version: string;
  terraform: { minimum: string; maximum_exclusive: string };
  deployment_bundle: { url: string; sha256: string };
  images: { app: string; backup: string };
};
