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
- CSRF, exact `Origin`, same-site Fetch Metadata, JSON content type, and the dashboard session are required for mutations.
- The agent never receives the host-only session cookie or passkey private key.
- OAuth scopes are limited to `kb:read`, `kb:write`, and `assets:read`.
- MCP schemas are strict and have no visibility fields.
- The MCP database role cannot update publication columns or execute the publication function.
- The dashboard role can create an intent but cannot change publication columns.
- The publisher role can only read intents/events and execute the narrowly defined function; it cannot edit content.

## Database roles

The application opens independent pools using independent SCRAM credentials:

- `context_use_auth`: Better Auth, passkeys, OAuth clients, grants, sessions, and security audit records.
- `context_use_dashboard`: private page and asset operations; no direct publication updates.
- `context_use_mcp`: page reads/writes and asset metadata reads; no asset mutation or publication.
- `context_use_public`: `SELECT` only on `published_pages` and `published_assets` security-barrier views.
- `context_use_publisher`: execute-only publication capability.
- `context_use_backup`: read-only database backup access.

The migration container alone uses the database administrator. The long-running app never receives that credential.

## Authentication

Initial enrollment requires both a random installation setup capability and the exact normalized owner email configured during deployment. The setup capability is delivered in the enrollment URL fragment and enrollment closes after the first credential is stored. The email is an account identifier only: it cannot create a session or recover access.

The owner passkey must be discoverable and WebAuthn user verification is enforced during both registration and authentication. Successful authentication creates a database-backed, revocable, uncached dashboard session lasting at most seven days with a twelve-hour idle limit. Production cookies are secure, HTTP-only, host-only, `SameSite=Lax`, and have no `Domain` attribute. The server rejects every additional registration, update, and deletion; the credential is immutable for the lifetime of the installation.

MCP OAuth uses authorization code with mandatory PKCE. Access tokens expire after fifteen minutes and are bound to the canonical `/mcp` audience and client identifier. Offline access requires separate consent. Refresh tokens rotate; reuse invalidates the token family. MCP also verifies the current client and consent record on every request, so dashboard revocation takes effect before a JWT expires.

## Content isolation

Public views select the exact published page version, not the current private version. Page and asset publication states are independent. Public rendering resolves only targets visible through public views, so a link to a private object reveals no title, path, filename, MIME type, size, or S3 key.

Raw HTML and remote inline media are removed from Markdown. Rendered HTML is sanitized and served under a restrictive CSP. Active file formats, including HTML and SVG, are forced to download. S3 buckets have all public-access blocks enabled, require TLS, use KMS encryption, and are never used as a public origin; access is through short-lived, object-specific signed URLs.

Private and public content use `Cache-Control: no-store` in v1. Unpublication prevents future access through context-use but cannot retract copies already made by third parties.

## Infrastructure and secrets

The EC2 security group exposes only HTTP/HTTPS; administration uses SSM and IMDSv2 is mandatory. PostgreSQL is reachable only on an internal Docker network. Persistent PostgreSQL data resides on a KMS-encrypted EBS volume. Assets, backups, and Terraform state use private, encrypted, versioned S3 buckets.

Each installation derives a unique identifier from the AWS account, region, and hostname. It namespaces bucket names, IAM resources, logs, SSM parameters, and Terraform state so installations cannot collide.

Secrets are generated locally in memory, sent directly to SSM `SecureString`, fetched on-instance into a root-only file, and mounted only where required. They are neither Terraform variables nor outputs. Images are deployed by immutable digest from a checksum-verified release bundle.

## Passkey permanence

There is no passkey recovery or rotation path in v1. Losing every copy of the credential permanently removes dashboard access and prevents publishing, republishing, slug changes, and unpublishing. The configured email cannot be used to bypass or replace the passkey.

Security issues should be reported as described in [SECURITY.md](../SECURITY.md), not in a public issue.
