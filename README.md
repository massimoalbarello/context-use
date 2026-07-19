# context-use

`context-use` is a private-by-default, single-owner knowledge base. It keeps Markdown pages in PostgreSQL, immutable asset bytes in S3, exposes an owner dashboard, and gives a trusted personal agent narrowly scoped access through MCP.

The public site is deliberately separate. Each installation starts with one required `/p/about` page whose initial published body is empty; every owner-authored page version or asset becomes public only after the signed-in owner reviews an exact publication intent and confirms it with a passkey. A portable full-knowledge export likewise requires a fresh, action-bound passkey assertion. Agent OAuth tokens cannot call dashboard routes, have no publication or export scope, and use a PostgreSQL role that cannot alter publication state.

## What v1 includes

- Hierarchical Markdown pages with immutable versions, commit messages, history, and full-text search.
- Private S3 assets whose bytes are always streamed through scope-specific API routes, with checksum-bound uploads and revocation-aware downloads.
- Passkey-only owner signup and sign-in, bound to the configured owner email through a one-time setup link.
- Passkey-protected publishing, republishing, and unpublishing with the same immutable credential.
- Passkey-protected streaming Zip64 export of current active pages and assets as a navigable Markdown vault with local links.
- OAuth 2.1 authorization code + PKCE for MCP, short-lived audience-bound access tokens, rotating refresh tokens, and live consent checks.
- Stateless Streamable HTTP MCP at `/mcp` with knowledge, checksum-bound asset upload/download, and automation execution tools.
- Anonymous, tools-only MCP on a dedicated `public.` hostname with a hierarchical index, page reads, and full-text search over published snapshots only.
- Versioned, discoverable Agent Skills; time-zone-aware automations; isolated generated knowledge; durable run history; and leased agent execution.
- Exact published snapshots at `/p/<knowledge-path>` and independently published assets at the same `/p/<knowledge-path>` route on a cookieless hostname.
- A built-in public billboard at `/` that directs people to the required `/p/about` page and agents to the installation-specific anonymous MCP endpoint.
- One-EC2 AWS deployment, encrypted retained storage, private versioned S3 buckets, SSM administration, daily backups, and a resumable CLI.

External ingestion, vault import, approval queues, collaboration, and semantic search are intentionally outside v1.

## Security model

| Principal | Credential | Accepted surface |
|---|---|---|
| Owner sign-in | Discoverable, user-verified passkey | Session creation |
| Owner | Host-only secure session cookie | `/api/dashboard/*` |
| Owner publishing | Session + CSRF + exact origin + action-bound passkey assertion | Publication confirmation only |
| Owner export | Same session + CSRF + exact origin + action-bound passkey assertion | One exact, single-use knowledge snapshot download |
| Personal agent | OAuth bearer token for the canonical MCP audience | `/mcp` only |
| Agent asset upload | Short-lived, object-specific capability returned by authenticated MCP | Exact returned `/api/mcp/assets/:id/content` URL only |
| Agent asset read | Five-minute, object-specific capability returned with `assets:read` | Exact returned `/api/mcp/assets/:id/content` URL only |
| Public visitor | None | Published pages at `/p/*`; independently published assets at `/p/*` on the asset hostname |
| Public MCP client | None; credentials are rejected | `https://public.YOUR_HOST/mcp` only |
| Deployment administrator | Local AWS identity | `context-use` CLI |

These credentials are intentionally non-interchangeable. Dashboard endpoints reject `Authorization`; MCP rejects cookies. Application roles mirror that boundary in PostgreSQL, and public requests query security-barrier views rather than base tables. Publishing a page never publishes linked pages or assets.

Internal page links are stored independently of either presentation route. Use `[[path|label]]` or `[label](context-use://page/<page-uuid>)`, never a hard-coded `/app/pages/*` or `/p/*` URL. Authorized dashboard rendering resolves a reference to `/app/pages/:id`; anonymous public rendering resolves it to `/p/<knowledge-path>` only when the target page is independently published. References to private targets are rendered as inert text without target metadata or identifiers.

The Settings export contains only the latest version of each non-archived page and every non-deleted asset. It mirrors knowledge folders, uses the friendly page titles and asset filenames, and rewrites Context Use UUID references and wikilinks to relative, URL-encoded Markdown links. It contains no manifest, history, publication state, account data, or database identifiers. Asset integrity is checked before the passkey prompt, and the Zip64 response streams through the application without exposing storage URLs or buffering the archive in browser memory.

See [Security architecture](docs/security.md) and [Operations](docs/operations.md) for the complete boundary and operating model.

## Deploy on AWS

Prerequisites:

- macOS or Linux on ARM64 or x86-64.
- An authenticated AWS CLI v2 profile with permission to create the documented resources. Browser sessions created by `aws login` are supported.
- Terraform `>= 1.11, < 2.0`.
- A hostname you control.
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

The CLI asks for the AWS profile, region, hostname, DNS mode, and owner email. It exports short-lived credentials from that profile to Terraform without storing access keys, creates everything else, stores secrets only as KMS-encrypted SSM parameters, deploys through Systems Manager, waits for TLS, and prints a one-time owner-enrollment link. The link asks for the configured email and creates the installation's permanent passkey; email is an identity label, not a sign-in or recovery method. Manual DNS setup pauses safely and continues with `context-use resume`.

Useful commands:

```text
context-use status
context-use doctor
context-use update [--version vX.Y.Z]
context-use backup
context-use restore
context-use open
context-use destroy
context-use destroy --purge-data
```

Ordinary `destroy` removes replaceable compute but retains encrypted data and Terraform state. `--purge-data` requires the hostname and a second destructive confirmation.

## Agent connection

### Private agent

Point an OAuth-capable MCP client at:

```text
https://YOUR_HOST/mcp
```

The server publishes protected-resource and authorization-server metadata. New dynamic clients can request all MCP tool scopes (`kb:read`, `kb:write`, `assets:read`, `assets:write`, `skills:read`, `skills:write`, `automations:write`, `automations:claim`, and `automations:execute`) so general-purpose clients can complete discovery, and the owner must approve the requested grant. `offline_access` requires explicit client request and owner consent; no publication or dashboard scope exists.

With `assets:write`, `create_asset_upload` records private asset metadata and returns a fifteen-minute upload capability bound to that asset and OAuth grant. The agent then sends the exact raw bytes to the returned API URL and headers. Size, content type, and SHA-256 are verified before storage; the capability cannot read, edit, delete, or publish anything. Existing OAuth grants must be reauthorized before they include the new scope.

With `assets:read`, `get_asset` returns metadata plus a five-minute API download request bound to that exact asset, MCP client, owner, and live grant. The download route rechecks the grant and supports byte ranges for large media. It never returns or redirects to an S3 URL. Dashboard reads use the owner-session API route, while anonymous reads use `/p/<knowledge-path>` on the asset host and resolve through the published-assets database view only.

### Public access

Anyone can connect an MCP client without authentication at:

```text
https://public.YOUR_HOST/mcp
```

The public server deliberately exposes tools rather than MCP resources for broad client compatibility:

- `get_about_page` returns the required public `about` page and a complete nested index of all published pages.
- `get_public_page` reads one page by its knowledge path and includes published breadcrumbs and children.
- `search_public_pages` searches only the sanitized published-page projection.
- `send_message` privately delivers a message plus the sender's required email or phone loopback address.

For example, a dashboard at `https://context.example.com` exposes its anonymous MCP at `https://public.context.example.com/mcp`. The dedicated origin serves no OAuth or OpenID metadata and has no route to the private application.

The public MCP runs in a separate isolated container with a separate database credential. Its role can select only `public_mcp_pages`, a lossy security-barrier view with published knowledge paths, titles, sanitized Markdown, and published-parent paths. It also has column-scoped insert access for message IDs, reply addresses, and bodies, but it cannot select messages, set their owner, or use `RETURNING` to read stored data. The authenticated dashboard filters the inbox by owner ID. The public role cannot read webpage views, other base tables, asset metadata, UUIDs, page versions, private reference targets, or S3 keys. Only published pages become hierarchy nodes or resolve through `/p/*`; an unpublished page remains unavailable even when its path is a prefix of a public descendant.

Skills live in the dashboard's **Skills** area and follow the [Agent Skills `SKILL.md` specification](https://agentskills.io/specification): a standard name and short description form the discovery layer, while instructions load only after selection. MCP agents use `list_skills`, `get_skill`, and `create_skill`. They are reusable capabilities selected by an agent and are never attached to scheduled work.

Automations live separately under **Automations** and can also be created with `create_automation`. Each automation owns immutable, versioned instructions plus its schedule and input parameters. Updating those instructions creates a new automation version; already-created runs remain pinned to the exact version they received. Existing installations migrate each attached skill version into the automation that used it and retire previously attached skill definitions from discovery without deleting their immutable history.

Every automation owns one stable virtual folder at `automations/<automation-key>`. The owner chooses the unique semantic key at creation and it cannot later change; the automation UUID remains internal ownership metadata. While an MCP client holds an active run claim, its generic page writes are disabled; run output requires the automation page tools and the valid run ID and claim token. The server resolves relative paths inside that folder. Database constraints reject ordinary pages in the reserved tree, automation pages outside their owner folder, generic edits to generated pages, and publication of generated pages.

Context Use does not require a resident scheduler process: loading the dashboard or calling `claim_due_run` transactionally materializes elapsed schedules. The first version creates one catch-up run per automation and skips additional occurrences missed while nobody was polling.

Any connected agent can use the same generic external cron prompt:

```text
Check Context Use for scheduled work. Call claim_due_run. If it returns a run,
follow its instructions using the supplied input. Continue until claim_due_run returns
null.
```

For claimed runs, Context Use appends the shared execution contract to the returned `instructions_markdown`: read `[[me/intro]]`, use the claim-scoped automation page tools inside the dedicated knowledge path, and finish with `complete_run` or `fail_run`. This happens only in the `claim_due_run` response. Skills and ordinary `get_skill` calls never receive automation execution context. While migrated instructions still contain a legacy `## Execution context` section, Context Use recognizes it and does not inject a duplicate.

Claims are atomic and leased for six hours. Runs, inputs, automation instruction versions, knowledge ownership, outcomes, and claimant identity remain in Context Use; the agent supplies only reasoning and tool calls for the current run.

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
