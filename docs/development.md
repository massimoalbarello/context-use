# Development

## Local PostgreSQL

Start PostgreSQL 17 on a local port:

```sh
docker run --name context-use-dev-db --rm \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=context_use \
  -p 5432:5432 postgres:17-alpine
```

In another shell, apply migrations and role passwords:

```sh
export MIGRATOR_DATABASE_URL=postgres://postgres:postgres@localhost:5432/context_use
export DB_AUTH_PASSWORD=development-only
export DB_DASHBOARD_PASSWORD=development-only
export DB_MCP_PASSWORD=development-only
export DB_PUBLIC_PASSWORD=development-only
export DB_PUBLISHER_PASSWORD=development-only
export DB_BACKUP_PASSWORD=development-only
bun run db:migrate
```

Copy `.env.example` to `.env`, set a Google OAuth development client if testing sign-in, then run the server and web development processes:

```sh
bun run dev:server
bun run dev:web
```

The Vite development server proxies application requests to the API server. Filesystem asset storage is used locally.

## Verification

Run the fast suite with `bun test`. Database privilege tests require `TEST_DATABASE_ADMIN_URL` and the role passwords shown above:

```sh
TEST_DATABASE_URL="$MIGRATOR_DATABASE_URL" bun run db:test:roles
```

CI additionally builds both container images, validates the Caddy configuration, validates both Terraform roots, and tests migrations against a clean PostgreSQL service.
