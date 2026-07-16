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

## Passkey permanence

The first fresh owner session can enroll one publication passkey. After enrollment, the installation does not allow that credential to be added, replaced, or removed through the dashboard, CLI, or an administrative endpoint.

Losing the passkey permanently prevents future publication changes, including unpublishing. Google sign-in and private dashboard access continue to work, but backups cannot recreate a lost private credential. Use a synced credential manager or a durable authenticator that you expect to retain before enrolling.

## First-party GitHub deployment

The maintainer installation is deployed from `main` by
`.github/workflows/cd.yml`; external installations continue to use the CLI.
GitHub authenticates to AWS with OIDC, so no long-lived AWS access keys are
stored in GitHub.

Bootstrap `infra/bootstrap/github-oidc-bootstrap.yaml` once in the target AWS
account, then configure these repository variables:

- `AWS_TERRAFORM_ROLE_ARN`
- `AWS_REGION` (defaults to `eu-west-2`)
- `CONTEXT_USE_APP_HOSTNAME`
- `CONTEXT_USE_ASSET_HOSTNAME` (optional; defaults to `assets.<app hostname>`)
- `CONTEXT_USE_AVAILABILITY_ZONE` (optional; defaults to `<region>a`)
- `CONTEXT_USE_ROUTE53_ZONE_ID` (optional for manual DNS)
- `CONTEXT_USE_OWNER_EMAIL`
- `CONTEXT_USE_GOOGLE_CLIENT_ID`

The first deployment also requires the repository secret
`CONTEXT_USE_GOOGLE_CLIENT_SECRET`. The workflow writes it to encrypted SSM and
generates all database and application secrets there; later deployments can run
without the GitHub secret unless the Google credential is being rotated.

Terraform plans containing any delete action are blocked on pushes. An
intentional replacement must be run manually with `allow_destroy` enabled. The
workflow takes a database backup before updating an existing installation,
deploys over SSM, and checks both the on-instance database permissions and the
public HTTP authentication boundary.
