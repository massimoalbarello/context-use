# Security architecture

## Non-bypassable publication boundary

The only private-to-public transition is:

```text
user-verified owner passkey
→ revocable dashboard session
→ reviewed immutable page version or exact asset
→ session-bound, five-minute publication intent
→ WebAuthn user verification
→ execute-only publication procedure
→ append-only publication event
```

The confirmation request carries only the intent identifier and authenticator response. The stored intent binds the operation, target UUID, page version, public slug, dashboard session, random challenge, owner, and expiry. Consuming it and changing visibility happen in one database transaction.

An agent cannot substitute its OAuth token for any step:

- `/api/dashboard/*` rejects every request containing `Authorization`, before handler logic.
- `/mcp` rejects session cookies.
- The dedicated public MCP origin's `/mcp` rejects both cookies and bearer credentials and has no network or routing path into the private origin's `/mcp`.
- CSRF, exact `Origin`, same-site Fetch Metadata, JSON content type, and the dashboard session are required for mutations.
- The agent never receives the host-only session cookie or passkey private key.
- OAuth scopes separate knowledge, skill discovery/authoring, asset read/write, and automation authoring/execution capabilities; none grants publication or dashboard access.
- MCP schemas are strict and have no visibility fields.
- The MCP database role cannot update publication columns or execute the publication function.
- The dashboard role can create an intent but cannot change publication columns.
- The publisher role can only read intents/events and execute the narrowly defined function; it cannot edit content.

## Database roles

The application opens independent pools using independent SCRAM credentials:

- `context_use_auth`: Better Auth, passkeys, OAuth clients, grants, and sessions.
- `context_use_dashboard`: private page, asset, and owner-filtered inbox reads; no inbox writes or direct publication updates.
- `context_use_mcp`: page reads/writes, asset metadata reads, insert-only asset upload intents, narrowly column-scoped skill and automation creation, and automation claiming/completion; no asset update/delete, skill or automation definition updates, or publication.
- `context_use_public`: `SELECT` only on `published_pages` and `published_assets` security-barrier views.
- `context_use_public_mcp`: `SELECT` only on the lossy `public_mcp_pages` security-barrier view plus column-scoped `INSERT` on confidential inbound messages; no message reads, owner selection, other base-table, webpage-view, asset, or application-function capability.
- `context_use_publisher`: execute-only publication capability.
- `context_use_backup`: read-only database backup access.

The migration container alone uses the database administrator. The long-running app never receives that credential.

## Authentication

Initial enrollment requires both a random installation setup capability and the exact normalized owner email configured during deployment. The setup capability is delivered in the enrollment URL fragment and enrollment closes after the first credential is stored. The email is an account identifier only: it cannot create a session or recover access.

The owner passkey must be discoverable and WebAuthn user verification is enforced during both registration and authentication. Successful authentication creates a database-backed, revocable, uncached dashboard session lasting at most seven days with a twelve-hour idle limit. Production cookies are secure, HTTP-only, host-only, `SameSite=Lax`, and have no `Domain` attribute. The server rejects every additional registration, update, and deletion; the credential is immutable for the lifetime of the installation.

MCP OAuth uses authorization code with mandatory PKCE. Access tokens expire after fifteen minutes and are bound to the canonical `/mcp` audience and client identifier. Offline access requires separate consent. Refresh tokens rotate; reuse invalidates the token family. MCP also verifies the current client and consent record on every request, so dashboard revocation takes effect before a JWT expires.

`assets:write` can create private asset metadata and a fifteen-minute, HMAC-authenticated upload capability bound to the exact asset, MCP client, owner, and active OAuth grant. The streaming upload route accepts neither cookies nor OAuth bearer credentials, rechecks the live grant, and validates content type, byte length, and SHA-256 against immutable metadata. The capability cannot select another asset or perform reads, updates, deletion, or publication.

`assets:read` can mint a separate five-minute, HMAC-authenticated download capability bound to the exact asset, MCP client, owner, and active OAuth grant. The streaming download route accepts neither cookies nor OAuth bearer credentials and rechecks the live grant before every full or ranged response. Upload and download capabilities use separate signatures and headers and cannot be substituted for one another. Dashboard asset reads require the host-only owner session. Anonymous asset reads accept no credentials, run through the public database role, and can select only independently published assets.

The `skills:read` scope exposes only names and descriptions during discovery; `get_skill` loads a complete standard `SKILL.md` after selection. `skills:write` creates versioned skills, while `automations:write` creates cron-triggered automations. MCP agents cannot update existing skill or automation definitions. They may read the exact skill version attached to a claimed run, advance an automation's next occurrence, create due run records, and update only run lifecycle columns.

Every automation has an immutable `automations/<automation-key>` knowledge prefix. The semantic key is unique and immutable, while the automation UUID remains internal ownership metadata. Generated page writes require `automations:execute`, a random run claim token, the matching OAuth client identifier, an active lease, and a relative path. While that client holds an active claim, generic page mutations are denied. The application resolves the full path; database ownership constraints and version triggers prevent path escape. Generic page update/archive operations exclude automation-owned pages, and generated pages cannot be published. Expired or completed claims cannot mutate content.

## Content isolation

Public views select the exact published page version, not the current private version. Page and asset publication states are independent. Public rendering resolves only targets visible through public views, so a link to a private object reveals no title, path, filename, MIME type, size, or S3 key.

The anonymous MCP uses a second projection rather than serializing the webpage views. That projection exposes only public slug, title, sanitized Markdown, and the slug of the closest published ancestor. Database-side redaction removes Context Use page/asset UUIDs, wikilink targets, HTML comments, script/style blocks, and raw HTML tags before the MCP process can read them. Hierarchy nodes are published pages only, so unpublished folder names and intermediate pages do not appear. The MCP process never receives raw paths, version identifiers, timestamps, asset metadata, or S3 object keys.

Raw HTML and remote inline media are removed from Markdown. Rendered HTML is sanitized and served under a restrictive CSP. Active file formats, including HTML and SVG, are forced to download. S3 buckets have all public-access blocks enabled, require TLS, and use KMS encryption. Upload and download bytes always pass through the appropriate application API boundary; S3 URLs are never exposed to dashboard users, MCP clients, or public visitors. Uploads are checksum-validated by S3, and large downloads support bounded byte ranges without buffering the full object in the application.

Private and public content use `Cache-Control: no-store` in v1. Unpublication prevents future access through context-use but cannot retract copies already made by third parties.

## Inbound message isolation

`send_message_to_owner` validates and trims a sender-supplied message and requires either an email address or phone number for replies. Its success response contains only a random receipt ID and never echoes the message or loopback address. The public MCP database role can insert the ID, reply address, and message body, but column privileges prevent it from setting `owner_user_id`; the table default binds every delivery to the installation's single owner. That role has no `SELECT` privilege on the inbox, including the privileges PostgreSQL requires for `RETURNING`.

The dashboard role can read the inbox but cannot write it. `/api/dashboard/messages` rejects bearer credentials and anonymous requests through the same cookie-only owner boundary as every private dashboard route, then filters the query by the authenticated owner's user ID. The dashboard renders message bodies as plain React text and constructs only fixed `mailto:` or `tel:` links from the validated reply address.

## Infrastructure and secrets

The EC2 security group exposes only HTTP/HTTPS; administration uses SSM and IMDSv2 is mandatory. PostgreSQL is reachable only on an internal Docker network. Persistent PostgreSQL data resides on a KMS-encrypted EBS volume. Assets, backups, and Terraform state use private, encrypted, versioned S3 buckets.

Each installation derives a unique identifier from the AWS account, region, and hostname. It namespaces bucket names, IAM resources, logs, SSM parameters, and Terraform state so installations cannot collide.

Secrets are generated locally in memory, sent directly to SSM `SecureString`, fetched on-instance into a root-only file, and mounted only where required. They are neither Terraform variables nor outputs. Images are deployed by immutable digest from a checksum-verified release bundle.

The anonymous MCP runs as a separate isolated container with no dashboard, auth, publisher, private MCP, storage, owner-identity, or AWS configuration. Its database credential can insert only the sender-supplied reply address and body under a database-assigned owner default; it cannot read the inbox or override its owner. Its two Docker networks are internal and dedicated: one connects only it and PostgreSQL, while the other connects only it and Caddy. It shares no network with the private application or outbound gateway. Its dedicated public hostname serves only the exact `/mcp` route; OAuth/OpenID discovery and every other path return `404`, while the old same-origin `/public/mcp` route is absent. The container drops all Linux capabilities, enables `no-new-privileges`, and receives only the dedicated public MCP database URL and public origins.

## Passkey permanence

There is no passkey recovery or rotation path in v1. Losing every copy of the credential permanently removes dashboard access and prevents publishing, republishing, slug changes, and unpublishing. The configured email cannot be used to bypass or replace the passkey.

Security issues should be reported as described in [SECURITY.md](../SECURITY.md), not in a public issue.
