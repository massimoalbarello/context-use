# Operations

## Deployment lifecycle

`context-use setup` bootstraps an installation-specific encrypted/versioned Terraform state bucket, applies the retained-data stack, applies replaceable compute, stores runtime secrets in SSM, configures optional Route 53 records, and deploys through SSM. Non-secret progress is stored with mode `0600` under `~/.config/context-use/config.json`.

`context-use resume` is idempotent across infrastructure phases. If interruption occurred before SSM secrets were complete, it asks for the Google client secret again; that secret is never saved locally.

`context-use update` takes a database backup, applies compatible Terraform changes, runs migrations, deploys images pinned by digest, then verifies health and credential separation. Failed application health checks redeploy the previous image release.

## Backups and restore

The backup companion creates a compressed, integrity-checked, logically restorable PostgreSQL dump every day and uploads it with KMS encryption. S3 lifecycle retains backups for 30 days by default.

`context-use backup` creates one immediately. `context-use restore` lists available backups, requires typing the hostname, creates a final safety backup, stops database clients, restores with `ON_ERROR_STOP`, and restarts the application.

Assets are protected independently through S3 versioning. PostgreSQL backups contain asset metadata and object keys, not asset bytes.

## Destroy semantics

`context-use destroy` removes EC2, networking, DNS managed by the compute stack, the Elastic IP, and replaceable logs/IAM resources. It deliberately retains EBS, asset and backup buckets, SSM secrets, KMS protection, and Terraform state so a future `resume` can reconstruct compute.

`context-use destroy --purge-data` is irreversible. After hostname confirmation and a second explicit prompt, it removes every version and delete marker from asset and backup buckets, removes SSM parameters, destroys the retained-data stack, and deletes the versioned state bucket. AWS schedules the KMS key for deletion using its 30-day safety window.

## Passkey recovery

Run:

```sh
context-use auth recover-passkey
```

The command operates through AWS Systems Manager rather than a public administrative endpoint. Open the emitted URL, sign in with the allowlisted Google account, consume the one-time token, and register a new passkey. Register a second passkey after recovery.
