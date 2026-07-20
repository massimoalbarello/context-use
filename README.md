# context-use

`context-use` is a private-by-default, single-owner knowledge base. It keeps Markdown pages in PostgreSQL, immutable asset bytes in S3, exposes an owner dashboard, and gives a trusted personal agent owner-authorized access through MCP.

The public site is deliberately separate. Each installation starts with a private root `AGENTS.md` page that tells connected agents to create `about/intro` for a concise owner introduction, keep it private by default, and ask the owner to review and publish it when they want the landing page to introduce them. Until then, `/p/about/intro` shows an empty state. Every owner-authored page version or asset becomes public only after the signed-in owner reviews an exact publication intent and confirms it with a passkey. A portable export of all current knowledge likewise requires a fresh, action-bound passkey assertion. Agent OAuth tokens cannot call dashboard routes, have no publication or export scope, and use a PostgreSQL role that cannot alter publication state.

## What v1 includes

- Hierarchical Markdown pages with immutable versions, commit messages, history, and full-text search.
- Private S3 assets whose bytes are always streamed through short-lived, object-specific API capabilities with checksum-bound uploads.
- Passkey-only owner signup and sign-in, bound to the configured owner email through a one-time setup link.
- Passkey-protected publishing, publication updates, and unpublishing with the same immutable credential.
- Passkey-protected streaming Zip64 export of current active pages and assets as a navigable Markdown vault with local links.
- OAuth 2.1 authorization code + PKCE for MCP, fifteen-minute audience-bound access tokens, rotating refresh tokens, and owner revocation.
- Stateless Streamable HTTP MCP at `/mcp` with knowledge, checksum-bound asset upload/download, and automation execution tools.
- Versioned, discoverable Agent Skills; time-zone-aware automations; isolated generated knowledge; durable run history; and leased agent execution.
- Exact published snapshots at `/p/<knowledge-path>` and independently published assets at `/a/<knowledge-path>` on a cookieless hostname.
- A built-in public billboard at `/` that directs visitors to optional `/p/about/intro` content.
- One-EC2 AWS deployment, encrypted retained storage, private versioned S3 buckets, SSM administration, daily backups, and a resumable CLI.

External ingestion, vault import, approval queues, collaboration, and semantic search are intentionally outside v1.

## Security model

| Principal | Credential | Accepted surface |
|---|---|---|
| Owner sign-in | Discoverable, user-verified passkey | Session creation |
| Owner | Host-only secure session cookie | `/api/dashboard/*` |
| Owner publishing | Session + CSRF + exact origin + action-bound passkey assertion | Publication confirmation only |
| Owner export | Same session + CSRF + exact origin + action-bound passkey assertion | One single-use export of all knowledge current when download starts |
| Personal agent | OAuth bearer token for the canonical MCP audience | `/mcp` only |
| Agent asset upload | Short-lived, object-specific capability returned by authenticated MCP | Exact returned `/api/mcp/assets/:id/content` URL only |
| Agent asset read | Five-minute, object-specific capability returned by authenticated MCP | Exact returned `/api/mcp/assets/:id/content` URL only |
| Public visitor | None | Published pages at `/p/*`; independently published assets at `/a/*` on the asset hostname |
| Deployment administrator | Local AWS identity | `context-use` CLI |

These credentials are intentionally non-interchangeable. Dashboard endpoints reject `Authorization`; MCP rejects cookies. Application roles mirror that boundary in PostgreSQL, and public requests query security-barrier views rather than base tables. Publishing a page never publishes linked pages or assets.

Production also enforces the boundary at the process level. Caddy routes only exact public path families to the credentialless dashboard edge, authentication authority, private MCP authority, and public renderer. Auth reapplies its OAuth/passkey route allowlist and requires pairwise capabilities on internal/dashboard routes; private MCP independently requires a signed audience-bound token or exact short-lived asset capability. The dashboard authority, authentication authority, private MCP authority, passkey confirmation, public rendering, and object storage are separate services, each with one database identity and only narrowly scoped additional capabilities. A routed connection is never authorization. The dashboard authority does not receive auth/MCP/confirmation/storage/public/backup/admin pool credentials or AWS access. A Unix-socket storage broker is the only asset process: every write must match immutable database integrity metadata, public reads are authorized by public path and translated to an object key only inside the broker, and deletion requires an already-deleted database row—which cannot exist while the asset is published. Private MCP cannot delete objects. The IMDS hop limit blocks every bridge container from the EC2 instance role; only an input-free host credential broker can reach it, and storage/backup receive separate short-lived, bucket-scoped role credentials.

Internal page links are stored independently of either presentation route. Use `[[path|label]]` or `[label](context-use://page/<page-uuid>)`, never a hard-coded `/app/pages/*` or `/p/*` URL. Authorized dashboard rendering resolves a reference to `/app/pages/:id`. Before anonymous code can read a published document, the database projection replaces references to independently published targets with public paths and turns private targets into inert labels. The public renderer therefore never receives the underlying UUID or private knowledge path.

Image assets use the same stable-reference model. A plain `![Alt text](context-use://asset/<asset-uuid>)` keeps its natural aspect ratio and is constrained to the content width. A small, sanitization-safe attribute block may immediately follow the reference:

```markdown
![Portrait](context-use://asset/<asset-uuid>){size=medium align=center shape=square}
```

The supported values are `size=small|medium|large|full`, `align=left|center|right`, `shape=auto|square|portrait|landscape`, and `layout=block|half|third`. Omitted values default to medium, centered, automatic aspect ratio, and block layout. Use `layout=half` on two consecutive images or `layout=third` on three consecutive images for equal responsive columns; the columns collapse on narrow screens. Enforced shapes crop with `object-fit: cover`. No arbitrary CSS is accepted, and unsupported or misspelled attributes remain visible in the rendered page for review. Assets remain independently private until the owner publishes them.

Authenticated MCP agents receive this syntax automatically in the `body_markdown` schema used by `create_page` and `update_page`; no separate discovery call is required. Successful image upload creation also returns ready-to-paste default and formatted Markdown examples.

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
context-use update
context-use backup
context-use restore
context-use recover
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

The server publishes protected-resource and authorization-server metadata. Dynamic clients receive the single `mcp:access` application scope, and the owner must approve that full private-MCP grant. `offline_access` requires an explicit client request and owner consent; no MCP grant can publish, export knowledge, or call dashboard routes.

MCP initialization tells the client to call `get_knowledge_base_guide` before managing pages. That tool reads the editable root `AGENTS.md` page. The initial guide reserves `about/` for information whose subject is the owner, asks the agent to create `about/intro` if missing, and keeps entities such as people, companies, and events in their own top-level folders. The database reserves bare `about` as a folder, but the intro page is an ordinary private page until the owner chooses to publish it; semantic placement is guided because the database cannot reliably infer a page's subject from Markdown.

`create_asset_upload` records private asset metadata and returns a fifteen-minute upload capability bound to that asset and the upload action. The agent then sends the exact raw bytes to the returned API URL and headers. Size, content type, and SHA-256 are verified before storage; the capability cannot read, edit, delete, or publish anything.

`get_asset` returns metadata plus a five-minute API download request bound to that exact asset and the download action. The capability supports byte ranges for large media and cannot be substituted for an upload capability. It never returns or redirects to an S3 URL. Dashboard reads use the owner-session API route, while anonymous reads use `/a/<knowledge-path>` on the asset host. The public web credential sees only safe download metadata; the object key is resolved from a separate storage-only projection inside the broker.

### Public access

The dashboard hostname serves the public billboard and exact owner-published page snapshots. Pages resolve at `/p/<knowledge-path>`. Independently published asset bytes resolve only at `/a/<knowledge-path>` on the dedicated cookieless asset hostname. Neither route can read current drafts, private link targets, private asset metadata, UUIDs, page versions, or S3 object keys.

Skills live in the dashboard's **Skills** area and follow the [Agent Skills `SKILL.md` specification](https://agentskills.io/specification): a standard name and short description form the discovery layer, while instructions load only after selection. MCP agents use `list_skills`, `get_skill`, and `create_skill`. They are reusable capabilities selected by an agent and are never attached to scheduled work.

Automations live separately under **Automations** and can also be created with `create_automation`. Each automation owns immutable, versioned instructions plus its schedule and input parameters. Updating those instructions creates a new automation version; already-created runs remain pinned to the exact version they received.

Every automation owns one stable virtual folder at `automations/<automation-key>`. The owner chooses the unique semantic key at creation and it cannot later change; the automation UUID remains internal ownership metadata. While an MCP client holds an active run claim, its generic page writes are disabled; run output requires the automation page tools and the valid run ID and claim token. The server resolves relative paths inside that folder. Database constraints reject ordinary pages in the reserved tree, automation pages outside their owner folder, generic edits to generated pages, and publication of generated pages.

Context Use does not require a resident scheduler process: loading the dashboard or calling `claim_due_run` transactionally materializes elapsed schedules. The first version creates one catch-up run per automation and skips additional occurrences missed while nobody was polling.

Any connected agent can use the same generic external cron prompt:

```text
Check Context Use for scheduled work. Call claim_due_run. If it returns a run,
follow its instructions using the supplied input. Continue until claim_due_run returns
null.
```

For claimed runs, Context Use appends the shared execution contract to the returned `instructions_markdown`: read `[[about/intro]]`, use the claim-scoped automation page tools inside the dedicated knowledge path, and finish with `complete_run` or `fail_run`. The generated knowledge page is the canonical output. `complete_run.result_summary` is an optional one- or two-sentence dashboard note about what changed and where, not a copy of the page. This happens only in the `claim_due_run` response. Skills and ordinary `get_skill` calls never receive automation execution context. While migrated instructions still contain a legacy `## Execution context` section, Context Use recognizes it and does not inject a duplicate.

Claims are atomic and leased for one hour. Expired claims are automatically available to the next polling agent. Runs, inputs, automation instruction versions, knowledge ownership, outcomes, and claimant identity remain in Context Use; the agent supplies only reasoning and tool calls for the current run.

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
