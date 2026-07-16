# context-use

`context-use` is a private-by-default, single-owner knowledge base. It keeps Markdown pages in PostgreSQL, immutable asset bytes in S3, exposes an owner dashboard, and gives a trusted personal agent narrowly scoped access through MCP.

The public site is deliberately separate: a page or asset becomes public only after the signed-in owner reviews an exact publication intent and confirms it with a passkey. Agent OAuth tokens cannot call dashboard routes, have no publication scope, and use a PostgreSQL role that cannot alter publication state.

## What v1 includes

- Hierarchical Markdown pages with immutable versions, commit messages, history, restore, backlinks, and full-text search.
- Private S3 assets with checksum-bound uploads and five-minute authorized downloads.
- Google sign-in restricted to one verified owner email.
- Passkey-protected publishing, republishing, slug changes, unpublishing, and passkey management.
- OAuth 2.1 authorization code + PKCE for MCP, short-lived audience-bound access tokens, rotating refresh tokens, and live consent checks.
- Stateless Streamable HTTP MCP at `/mcp` with page read/write and asset-read tools only.
- Exact published snapshots at `/p/:slug` and independently published assets on a cookieless hostname.
- One-EC2 AWS deployment, encrypted retained storage, private versioned S3 buckets, SSM administration, daily backups, and a resumable CLI.

External ingestion, vault migration, automations, approval queues, collaboration, and semantic search are intentionally outside v1.

## Security model

| Principal | Credential | Accepted surface |
|---|---|---|
| Owner | Host-only secure session cookie | `/api/dashboard/*` |
| Owner publishing | Session + CSRF + exact origin + action-bound passkey assertion | Publication confirmation only |
| Personal agent | OAuth bearer token for the canonical MCP audience | `/mcp` only |
| Public visitor | None | `/p/*` and independently published assets |
| Deployment administrator | Local AWS identity | `context-use` CLI |
| First-party production deployer | GitHub OIDC identity restricted to `main` | GitHub Actions CD only |

These credentials are intentionally non-interchangeable. Dashboard endpoints reject `Authorization`; MCP rejects cookies. Application roles mirror that boundary in PostgreSQL, and public requests query security-barrier views rather than base tables. Publishing a page never publishes linked pages or assets.

See [Security architecture](docs/security.md) and [Operations](docs/operations.md) for the complete boundary and recovery model.

## Deploy on AWS

Prerequisites:

- macOS or Linux on ARM64 or x86-64.
- An authenticated AWS CLI profile with permission to create the documented resources.
- Terraform `>= 1.11, < 2.0`.
- A hostname you control.
- A Google OAuth web client. Configure `https://YOUR_HOST/api/auth/callback/google` as its authorized redirect URI.
- GitHub CLI for release-provenance verification during installation.

Install the signed release artifact:

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/massimoalbarello/context-use/releases/latest/download/install.sh | sh
```

Ensure `~/.local/bin` is on `PATH`, then run:

```sh
context-use setup
```

The CLI asks for the AWS profile, region, hostname, DNS mode, owner email, and Google credentials. It creates everything else, stores secrets only as KMS-encrypted SSM parameters, deploys through Systems Manager, waits for TLS, and checks the authentication boundary. Manual DNS setup pauses safely and continues with `context-use resume`.

Useful commands:

```text
context-use status
context-use doctor
context-use update [--version vX.Y.Z]
context-use backup
context-use restore
context-use open
context-use auth recover-passkey
context-use destroy
context-use destroy --purge-data
```

Ordinary `destroy` removes replaceable compute but retains encrypted data and Terraform state. `--purge-data` requires the hostname and a second destructive confirmation.

The project maintainer's production installation is managed separately by the
[`CD (production)` workflow](.github/workflows/cd.yml). This does not change the
CLI deployment path for external self-hosters. The CD workflow builds images
pinned by digest, applies guarded Terraform plans against installation-specific
encrypted state, stores runtime secrets in KMS-encrypted SSM parameters, deploys
through Systems Manager, and verifies the live security boundary.

## Agent connection

Point an OAuth-capable MCP client at:

```text
https://YOUR_HOST/mcp
```

The server publishes protected-resource and authorization-server metadata. New dynamic clients receive `kb:read` by default. The owner must separately approve `kb:write`, `assets:read`, and `offline_access`; no publication or administration scope exists.

## Development

The repository uses Bun 1.3, TypeScript, PostgreSQL 17, React, Elysia, Better Auth, the MCP TypeScript SDK, Terraform, Docker Compose, and Caddy.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun --cwd apps/web build
terraform -chdir=infra/data init -backend=false
terraform -chdir=infra/data validate
terraform -chdir=infra/compute init -backend=false
terraform -chdir=infra/compute validate
```

Local database and application setup is documented in [Development](docs/development.md).

## License

MIT
