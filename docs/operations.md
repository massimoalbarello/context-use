# Operations

## Deployment lifecycle

`context-use setup` bootstraps an installation-specific encrypted/versioned Terraform state bucket, applies the retained-data stack, applies replaceable compute, stores runtime secrets in SSM, configures optional Route 53 records, and deploys through SSM. Non-secret progress is stored with mode `0600` under `~/.config/context-use/config.json`.

The selected AWS CLI profile remains the source of authentication. Before each Terraform operation, the CLI uses `aws configure export-credentials` to pass short-lived credentials through the child-process environment. This supports `aws login`, SSO, credential-process, role, and conventional profiles without persisting exported credentials or embedding them in Terraform backend configuration.

`context-use resume` is idempotent across infrastructure phases. If interruption occurred before SSM secrets were complete, it regenerates and stores the installation secrets before continuing. A resumed manual-DNS installation pauses after compute and secrets are ready, prints both required A records, and deploys only after the next `resume`.

After deployment, the CLI prints an owner-enrollment URL containing a random setup capability in its fragment. The browser removes the fragment from its address bar, asks for the configured owner email, and sends both values only as part of the same-origin passkey ceremony. Enrollment closes permanently after the first credential is stored. The email labels the owner account but is not an authentication or recovery factor.

`context-use update` takes a database backup, applies compatible Terraform changes, runs migrations, deploys images pinned by digest, then verifies health and credential separation. Failed application health checks redeploy the previous image release.

## Backups and restore

The backup companion creates a compressed, integrity-checked, logically restorable PostgreSQL dump every day and uploads it with KMS encryption. S3 lifecycle retains backups for 30 days by default.

`context-use backup` creates one immediately. `context-use restore` lists available backups, requires typing the hostname, creates a final safety backup, stops database clients, restores with `ON_ERROR_STOP`, and restarts the application.

Assets are protected independently through S3 versioning. PostgreSQL backups contain asset metadata and object keys, not asset bytes.

## Destroy semantics

`context-use destroy` removes EC2, networking, DNS managed by the compute stack, the Elastic IP, and replaceable logs/IAM resources. It deliberately retains EBS, asset and backup buckets, SSM secrets, KMS protection, and Terraform state so a future `resume` can reconstruct compute.

`context-use destroy --purge-data` is irreversible. After hostname confirmation and a second explicit prompt, it removes every version and delete marker from asset and backup buckets, removes SSM parameters, destroys the retained-data stack, and deletes the versioned state bucket. AWS schedules the KMS key for deletion using its 30-day safety window.

## Passkey permanence

The one-time owner-enrollment link creates one discoverable, user-verified passkey. After enrollment, the installation does not allow that credential to be added, replaced, or removed through the dashboard, CLI, or an administrative endpoint.

Losing the passkey permanently prevents dashboard sign-in and every future publication change, including unpublishing. Email cannot recover access, and backups cannot recreate a lost private credential. Use a synced credential manager or a durable authenticator that you expect to retain before enrolling.
