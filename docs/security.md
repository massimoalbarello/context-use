# Security architecture

## Authorization model

Context Use has one owner, but several callers with very different trust levels. HTTP authentication and OAuth select a dedicated database pool; PostgreSQL then limits the maximum damage available through that pool. The intended boundaries are:

| Actor | May read | May change | Must never do |
|---|---|---|---|
| Anonymous webpage visitor | Exact published page versions and independently published assets | Nothing | See private/current drafts, auth data, skills, automations, or storage records for private assets |
| Authenticated owner dashboard | All private knowledge, assets, skills, automations, and OAuth connections | Manage private state and create short-lived publication/export intents | Directly set publication state or mark an export confirmed without a fresh passkey assertion |
| Owner-authorized private MCP client | Private knowledge, assets, skills, and automation state | Author private pages/assets/skills/automations and execute automations | Read auth data, publish, export, or bypass the public projection and storage boundaries |
| Dashboard edge | Browser dashboard/static requests and owner cookies in transit | Forward only dashboard/static route families to the authority | Hold any database URL, pairwise/storage capability, signing secret, AWS access, or network route to another private authority |
| Dashboard authority | Owner-authorized private requests | Apply session/origin/CSRF checks, private CRUD, and narrowly delegated auth/confirmation/storage calls | Attach to Caddy or accept the edge connection as authorization |
| Authentication authority | The single-owner account, passkey, sessions, OAuth clients, grants, and tokens | Serve allowlisted public auth/OAuth routes and capability-gated internal/dashboard routes | Accept a routed connection as authorization, hold a knowledge database credential, read knowledge data, or publish/export content |
| Private MCP authority | Owner-approved MCP requests | Validate a signed audience-bound token or exact short-lived asset capability and perform only that operation | Accept a routed connection as authorization, read auth data, publish/export, or obtain AWS credentials |
| Confirmation service | Passkey public verification fields and the exact publication/export intent fields | Generate a challenge; execute the fixed confirm/claim procedures after WebAuthn verification | Hold a knowledge or auth pool credential, read content, or choose an operation outside the stored intent |
| Storage broker | Asset bytes, immutable asset-integrity fields, and the storage-only published-path projection | Perform only the operation allowed by the caller's Unix-socket capability | Accept bytes that do not match the database row, serve an unpublished object publicly, or expose S3 credentials/URLs to a web process |
| Backup process | All database relations | Nothing | Mutate data or create database objects |
| Migrator | Everything, during deployment only | Schema, roles, and grants | Remain present in any long-running container |

The private MCP is therefore not anonymous. Only the owner can complete its OAuth authorization flow and grant `mcp:access` to a client.

### Why connection roles instead of row-level security

Row-level security is useful when one database role must distinguish tenants or users row by row. Context Use has one fixed owner, and each pool already represents a distinct service capability, so there is no meaningful tenant predicate for RLS to enforce. Adding allow-all policies per private service would duplicate grants, complicate backups and security-definer views, and would not distinguish two requests sharing the same pool.

The database instead uses deny-by-default schema privileges, exact table and column grants, execute-only procedures, and security-barrier views. Application roles cannot create schemas or temporary objects, cannot inherit or assume the two internal owner roles, and receive no access to a newly created table, function, or mutable column until a migration grants it explicitly. Public views and privileged procedures are owned by separate `NOLOGIN`/non-superuser roles with only the underlying privileges their definitions require; they are not owned by PostgreSQL's administrator. Each credential-holding long-running service receives exactly one database URL, while the dashboard ingress edge receives none; production startup fails if another service's URL or secret is present.

## Non-bypassable publication boundary

The only private-to-public transition is:

```text
user-verified owner passkey
→ revocable dashboard session
→ reviewed immutable page version or exact asset
→ dashboard-created, session-bound, five-minute publication intent
→ confirmation-service-generated globally unique challenge
→ WebAuthn user verification
→ execute-only publication procedure
```

The browser confirmation request carries only the intent identifier and authenticator response. Caddy sends every dashboard route to a credentialless dashboard edge; that edge can reach only the isolated dashboard authority, which still treats the connection as untrusted and validates the request. An exact pairwise capability lets the dashboard authority forward the auth-owned confirmation route to the internal authentication authority. The authentication authority reconstructs the public request origin, validates the host-only owner session, exact origin, same-origin Fetch Metadata, CSRF token, and JSON content type, then discards the browser cookie and CSRF token and forwards only the already-established owner/session identifiers plus the assertion over another internal pairwise network. Neither Caddy nor any public edge can call the confirmation service. The confirmation service is not attached to a Caddy network and never receives reusable browser credentials. The dashboard credential cannot set a challenge or call a confirmation function. The isolated confirmation service generates the WebAuthn challenge and persists it through an execute-only procedure. A global challenge ledger is the single source of challenge state and prevents the same challenge from being used for publication and export. The intent binds the operation, target UUID, page version, server-derived public path, dashboard session, owner, and expiry; the ledger binds its challenge to the intent kind and ID. Challenge deletion, passkey-counter advancement, and visibility change happen in one database transaction; a stale counter, replay, concurrent confirmation, or mismatched credential fails the entire transition. The caller cannot choose a public alias: each page or asset public path comes from the reviewed knowledge record, and the publication procedure verifies it again.

Migrations bootstrap only a private root `AGENTS.md` structure guide. It tells agents to create `about/intro` if missing, keep it private by default, and ask the owner to review and publish it if they want the landing page to introduce them. The page has no special database authority or lifecycle rules; publishing it requires the same passkey flow as any owner-authored page. Until it is published, `/p/about/intro` returns a built-in empty-state document rather than private content.

An agent cannot substitute its OAuth token for any step:

- `/api/dashboard/*` rejects every request containing `Authorization`, before handler logic.
- `/mcp` rejects session cookies.
- CSRF, exact `Origin`, same-site Fetch Metadata, JSON content type, and the dashboard session are required for mutations.
- The agent never receives the host-only session cookie or passkey private key.
- The single `mcp:access` scope grants the private MCP toolset; it grants neither publication, export, nor dashboard access.
- MCP schemas are strict and have no visibility fields.
- The MCP database role cannot update publication columns or execute the publication function.
- The dashboard role can create an intent but cannot change publication columns.
- The confirmation role can select only passkey public-verification fields and exact intent fields, and can execute only challenge/confirmation/claim functions; it cannot read or edit content.

## Non-bypassable knowledge export boundary

A complete current-knowledge export requires a separate action-bound ceremony:

```text
user-verified owner passkey
→ revocable dashboard session + same-origin CSRF-protected snapshot request
→ immutable list of active current page versions and active asset metadata
→ session-bound, five-minute intent + confirmation-service challenge
→ WebAuthn user verification
→ execute-only confirmation procedure
→ same-session, same-origin, single-use download claim
→ streamed Zip64 response
```

Snapshot creation reveals no content outside the already authenticated dashboard. The dashboard role can insert and read snapshot rows but cannot set the challenge, confirmation, credential, or download fields and cannot execute the confirmation or claim functions. Only the confirmation role can execute those functions, and it cannot read the snapshot tables. The confirmation service independently loads the registered credential's public key, verifies origin, RP ID, user verification, challenge, signature, and authenticator counter, then asks PostgreSQL to consume the challenge and advance that counter atomically. Both procedures recheck the exact owner, session, expiry, and state. The browser-facing auth gateway additionally requires exact origin, same-origin Fetch Metadata, CSRF, JSON, and a valid owner session before stripping those reusable credentials and passing the assertion inward. The download route accepts no bearer token, rejects missing or non-same-origin Fetch Metadata, rechecks the same dashboard session, atomically consumes the authorization before streaming, and cannot be replayed.

The authorized operation is “export all current knowledge,” not a preselected historical snapshot. When download starts, one repeatable-read transaction selects current non-archived page Markdown and current non-deleted asset metadata. It excludes UUIDs, history, archived pages, publication state, auth data, OAuth data, and operational metadata. Context Use references are resolved against that transactionally consistent selection and rewritten to collision-safe relative Markdown links. Assets are integrity-checked before the passkey ceremony and again against the selected download set. Exports whose uncompressed content exceeds 5 GiB are rejected. Zip64 generation reads asset bytes through the private storage API with bounded stream backpressure; it never exposes an S3 URL or builds the archive in browser memory. The resulting local ZIP is deliberately unencrypted, and the confirmation dialog warns the owner before invoking WebAuthn.

## Database roles

The application opens independent pools using independent SCRAM credentials:

- `context_use_auth`: Better Auth, OAuth clients, grants, and sessions. It can create the one initial passkey and advance its counter, but cannot update credential identity/public-key fields, decrease the counter, or delete the owner/passkey.
- `context_use_dashboard`: private page and asset reads/writes plus short-lived intent creation; no direct publication updates.
- `context_use_mcp`: page reads/writes, asset metadata reads, insert-only asset upload intents, narrowly column-scoped skill and automation creation, and automation claiming/completion; no asset update/delete, skill or automation definition updates, or publication.
- `context_use_public`: `SELECT` only on `published_pages` and `published_assets` security-barrier views plus execution of the pure lossy webpage projector used by those views. The projector accepts only an already-public path and loads that published row internally; callers cannot supply a body, UUID, or private source path.
- `context_use_confirmation`: column-scoped reads of the registered passkey's public verification material and exact intent fields, plus execute-only challenge, publication, and passkey-confirmed export capabilities; no auth secrets or content reads.
- `context_use_storage`: column-scoped reads of asset identity, object key, filename, type, size, hash, and deletion state plus the storage-only public-path-to-object-key projection; no knowledge, auth, or metadata writes.
- `context_use_backup`: read-only database backup access.

Two internal roles can never log in and are never granted to an application identity:

- `context_use_projection_owner` owns the four projection views and the pure lossy Markdown projection function; it can select only the knowledge and asset fields those projections require. The function does not expose arbitrary projection arguments: a direct caller can request only the same explicitly published page already visible through its public view.
- `context_use_boundary_owner` owns the `SECURITY DEFINER` challenge/confirmation/claim procedures and can select or update only challenge, passkey-counter, visibility, and export-boundary fields.

The migration container alone uses the database administrator. No long-running service receives that credential, and there is no combined production application process: the dashboard edge, dashboard/auth/MCP authorities, public web, confirmation, storage, and backup start independently.

### Long-running process inventory

| Process | Database identity | Other private capability | Publicly routed work |
|---|---|---|---|
| Dashboard edge | None | None | Dashboard/static route allowlist forwarding only |
| Dashboard authority | `context_use_dashboard` | Dashboard-only storage, dashboard→auth, and dashboard→confirmation capabilities | None directly; owner-session/origin/CSRF-gated private CRUD over an isolated edge network |
| Auth authority | `context_use_auth` | Better Auth secret, owner bootstrap configuration, dashboard/MCP inbound capabilities, and confirmation-gateway capability | Allowlisted passkey/session/OAuth routes; private calls remain capability-scoped over isolated internal networks |
| Private MCP authority | `context_use_mcp` | MCP capability-signing, MCP-only storage, and MCP→auth JWKS capability | MCP protocol and exact asset-capability routes; validates every credential before state access |
| Confirmation | `context_use_confirmation` | Auth-gateway and dashboard-caller verifiers | None; internal publication/export WebAuthn verification only |
| Public web | `context_use_public` | Public read-only storage token | Billboard, published pages, published assets |
| Storage broker | `context_use_storage` (asset integrity + publication check only) | Short-lived asset-role credentials, bucket configuration, three distinct socket tokens | No TCP/HTTP route; Unix socket only |
| Backup | `context_use_backup` | Short-lived backup-role credentials and backup bucket configuration | No application route |
| AWS credential broker | None | EC2 instance role and permission to assume only the storage/backup roles | No listening socket or application input; write scoped credential files only |

This inventory is intentionally non-transitive. Every `/internal/*` handler also requires the exact pairwise caller capability, so bidirectional Docker connectivity alone is never authorization. For example, the public web process knows a public storage token but cannot use it for private broker routes; the private MCP token cannot call dashboard auth or delete objects; the dashboard can create an intent but cannot create its challenge through the database; and the confirmation service can verify a passkey but cannot read the content whose visibility it changes.

## Authentication

Initial enrollment requires both a random installation setup capability and the exact normalized owner email configured during deployment. The setup capability is delivered in the enrollment URL fragment and enrollment closes after the first credential is stored. The email is an account identifier only: it cannot create a session or recover access.

The owner passkey must be discoverable and WebAuthn user verification is enforced during both registration and authentication. Successful authentication creates a database-backed, revocable, uncached dashboard session lasting at most seven days with a twelve-hour idle limit. Better Auth's sliding refresh is disabled: authorization reads the original timestamps without refreshing, rejects an expired/idle/over-age session, then conditionally advances only `updatedAt`; it never extends `expiresAt`. Production cookies are secure, HTTP-only, host-only, `SameSite=Lax`, and have no `Domain` attribute. The HTTP policy rejects every additional registration, update, and deletion. Independently, database grants and immutable-row triggers prevent every application role from deleting the owner/passkey, replacing its identity/public key, or rolling its counter backward; the credential is immutable for the lifetime of the installation.

MCP OAuth uses authorization code with mandatory PKCE and one `mcp:access` application scope. Access tokens expire after fifteen minutes and are bound to the canonical `/mcp` audience and client identifier. Offline access requires separate consent. Refresh tokens rotate; reuse invalidates the token family. Dashboard revocation immediately removes consent and disables refresh, while an already issued access token remains valid until its signed expiry, at most fifteen minutes later.

`create_asset_upload` can create private asset metadata and a fifteen-minute, HMAC-authenticated capability bound to the exact asset and upload action. The streaming upload route accepts neither cookies nor OAuth bearer credentials and validates content type, byte length, and SHA-256 against immutable metadata. The capability cannot select another asset or perform reads, updates, deletion, or publication.

`get_asset` can mint a five-minute, HMAC-authenticated capability bound to the exact asset and download action. The streaming download route accepts neither cookies nor OAuth bearer credentials and supports full or ranged responses. Upload and download use one signing implementation but distinct action-bound payloads and headers, so they cannot be substituted for one another. Dashboard asset reads require the host-only owner session. Anonymous asset reads accept no credentials, run through the public database role, and can select only independently published assets.

`list_skills` exposes only names and descriptions during discovery; `get_skill` loads a complete standard `SKILL.md` after selection, and `create_skill` creates versioned skills. Skills are never attached to automations. `create_automation` creates cron-triggered automations with their own immutable instruction versions. MCP agents cannot update existing skill or automation definitions. They may read the exact automation version pinned to a claimed run, advance an automation's next occurrence, create due run records, and update only run lifecycle columns.

Every automation has an immutable `automations/<automation-key>` knowledge prefix. The semantic key is unique and immutable, while the automation UUID remains internal provenance metadata. Optional page creation and run-scoped updates require a random claim token, the matching OAuth client identifier, an active lease, and a relative path. While that client holds an active claim, generic page mutations are denied. The application resolves initial run output inside the automation's prefix, and database constraints prevent unrelated pages from occupying the reserved automation tree. Expired or completed claims cannot use run-scoped mutations.

Once created, automation output follows the ordinary page lifecycle. Dashboard and MCP page operations can create new private versions, move the page outside the reserved tree, or archive it while unpublished. Publication is still unavailable to MCP: only the owner dashboard can create a version-bound publication intent, and the isolated confirmation flow requires a fresh action-bound passkey assertion before visibility changes.

## Content isolation

Public views select the exact published page version, not the current private version. Page and asset publication states are independent. Anonymous page routes use `/p/*` on the app origin, while anonymous asset routes use `/a/*` on the asset origin; both resolve only through public views, so guessing a private path returns the same `404` as a missing path. Before the public renderer can read Markdown, a database-owned projection removes UUIDs, version metadata, private source paths, comments, scripts/styles, raw HTML, legacy dashboard/MCP asset routes, and private link targets. Independently published link and asset targets become public paths; private targets become inert labels. A final canonical-UUID scrub fails closed for unknown legacy URL shapes. The public renderer has no private identifier lookup capability. Database constraints prevent ordinary dashboard/MCP lifecycle updates from archiving a published page or deleting a published asset. The storage broker independently refuses physical deletion until the database row is already deleted, so the dashboard storage capability cannot bypass passkey-confirmed unpublication.

Raw HTML and remote inline media are removed from Markdown. The renderer recognizes only a fixed image-formatting grammar on stable Context Use asset references and maps its enumerated values to allowlisted classes; arbitrary attributes and CSS never pass through. Dashboard previews and public documents load the same self-hosted layout stylesheet under the restrictive CSP. Rendered HTML is sanitized. Active file formats, including HTML and SVG, are forced to download. S3 buckets have all public-access blocks enabled, require TLS, and use KMS encryption. Web services have no S3 or AWS credential path; all bytes pass through a small Unix-socket storage broker. Dashboard and private-MCP callers use distinct unguessable capabilities. Client containers mount the socket volume read-only, so none can replace the broker socket or capture another caller's capability. MCP can read and upload but cannot delete or invoke integrity-management operations. Before any write, the broker requires the caller's asset ID, object key, filename, type, size, and SHA-256 to exactly match an active database row; the backend then verifies the streamed bytes against that database-authorized hash. Writes are serialized by object key and fail if bytes already exist, so an MCP compromise can neither race a different payload into a pending object nor replace a private or published object in place. The public web process sends only a validated public path; the broker resolves that path against `storage_published_assets` and alone learns the object key. S3 URLs are never exposed to dashboard users, MCP clients, or public visitors. Uploads are checksum-validated by S3, and large downloads support bounded byte ranges without buffering the full object in a web process.

Private and public content use `Cache-Control: no-store` in v1. Unpublication prevents future access through context-use but cannot retract copies already made by third parties.

## Infrastructure and secrets

The EC2 security group exposes only HTTP/HTTPS; administration uses SSM and IMDSv2 is mandatory. The instance-metadata response hop limit is one. Every application, storage, and backup container uses a bridge network and explicitly disables EC2 metadata, so none can obtain the instance role or use its SSM access to recover other services' secrets. A tiny host-network credential broker is the sole IMDS consumer. It has no listening socket or application input, assumes separate IAM roles limited to the asset or backup bucket, and atomically refreshes one-hour credentials into two distinct volumes. The base instance role has no direct S3 permission. Storage and backup mount only their own volume read-only and use dedicated outbound networks; neither receives the base instance credential. PostgreSQL has no host-published port and is reachable only over role-specific internal networks. Persistent PostgreSQL data resides on a KMS-encrypted EBS volume. Assets, backups, and Terraform state use private, encrypted, versioned S3 buckets.

Each installation derives a unique identifier from the AWS account, region, and hostname. It namespaces bucket names, IAM resources, logs, SSM parameters, and Terraform state so installations cannot collide.

Secrets are generated locally in memory, sent directly to SSM `SecureString`, and fetched on-instance into a root-only runtime file used only for Compose substitution. That file is not mounted into application containers. Compose injects only the exact credential required by each process: one database URL plus, where needed, narrow pairwise/storage capabilities or one cryptographic secret. Production configuration rejects a URL naming the wrong PostgreSQL role, any other service's explicitly present database URL/secret, explicit AWS credentials in web processes, shared storage capabilities, and `SERVICE_MODE=all`. Storage additionally refuses to start unless EC2 metadata is disabled and its scoped credential-file path is exact. Long-lived AWS access keys are never created; the storage/backup role credentials expire after one hour. Runtime secrets are neither Terraform variables nor outputs. Images are deployed by immutable digest from a checksum-verified release bundle.

Caddy shares an internal web network with the credentialless dashboard edge, authentication authority, private MCP authority, and public renderer. Its exact path routing and body limits reduce exposure, but neither auth nor MCP trusts the connection: auth reapplies the public protocol allowlist and requires pairwise capabilities for internal/dashboard routes, while MCP requires a signed audience-bound token or action-bound asset capability. The dashboard authority remains isolated behind its credentialless edge and holds only `context_use_dashboard`, its storage capability, and the two narrow caller capabilities required to ask auth to validate a dashboard request and confirmation to issue/claim a ceremony. It does not hold the auth, MCP, public, confirmation, storage, backup, PostgreSQL-admin, Better Auth signing, MCP capability-signing, confirmation-gateway, S3, or SSM credential. Each database role has a separate internal network shared only with PostgreSQL; authority calls use distinct dashboard, MCP, and confirmation networks. A common database network cannot become a lateral service bus, and every internal endpoint rejects callers missing its pairwise capability. Confirmation has no Caddy-facing network.

## Passkey permanence

There is no passkey recovery or rotation path in v1. Losing every copy of the credential permanently removes dashboard access and prevents publishing, updating publication, unpublishing, and portable knowledge export. The configured email cannot be used to bypass or replace the passkey.

Security issues should be reported as described in [SECURITY.md](../SECURITY.md), not in a public issue.
