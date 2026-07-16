export type DeploymentPhase = "new" | "data_ready" | "compute_ready" | "awaiting_dns" | "deployed" | "destroyed" | "purged";

export type DeploymentConfig = {
  schemaVersion: 1;
  releaseVersion: string;
  phase: DeploymentPhase;
  environment: string;
  installationId: string;
  awsProfile: string;
  awsRegion: string;
  availabilityZone: string;
  accountId: string;
  hostname: string;
  assetHostname: string;
  dnsMode: "route53" | "manual";
  route53ZoneId: string;
  ownerEmail: string;
  parametersReady: boolean;
  stateBucket: string;
  stateKmsKeyArn?: string;
  stateKmsKeyId?: string;
  instanceType: string;
  dataVolumeSizeGb: number;
  backupRetentionDays: number;
  dataOutputs?: {
    kms_key_arn: string;
    kms_key_id: string;
    data_volume_id: string;
    asset_bucket: string;
    backup_bucket: string;
  };
  computeOutputs?: {
    instance_id: string;
    public_ip: string;
    app_url: string;
    asset_url: string;
    cloudwatch_log_group: string;
  };
};

export type ReleaseManifest = {
  version: string;
  terraform: { minimum: string; maximum_exclusive: string };
  deployment_bundle: { url: string; sha256: string };
  images: { app: string; backup: string };
};
