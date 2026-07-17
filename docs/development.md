# Development

## Docker Compose development environment

Start PostgreSQL, run the migrations, and launch the API and Vite development servers:

```sh
docker compose up --build
```

The root Compose file includes `compose.dev.yml`. The source tree is bind-mounted into the API and web containers, so both servers reload as files change. PostgreSQL data, uploaded assets, and container dependencies live in named Docker volumes.

Open the one-time local owner enrollment page:

```sh
http://localhost:5173/app#setup=development-owner-setup-token-0000000000000
```

The default owner email is `you@example.com`. Override it for a fresh database with `OWNER_EMAIL=me@example.com docker compose up --build`.

Stop the containers without removing local data:

```sh
docker compose down
```

To discard the local database, assets, and installed container dependencies as well, add `--volumes` to the `down` command.

## Host processes with a containerized database

If you prefer running Bun directly on the host, start only the database and migration services:

```sh
docker compose up -d postgres
docker compose run --rm migrate
bun install --frozen-lockfile
cp .env.example .env
bun run dev:server
bun run dev:web
```

The Vite development server proxies application requests to the API server. Filesystem asset storage is used locally. The development setup token is fixed; production setup always generates a random token.

## Verification

Run the fast suite with `bun test`. Database privilege tests require `TEST_DATABASE_ADMIN_URL` and the role passwords shown above:

```sh
TEST_DATABASE_URL="$MIGRATOR_DATABASE_URL" bun run db:test:roles
```

CI additionally builds both container images, validates the Caddy configuration, validates both Terraform roots, and tests migrations against a clean PostgreSQL service.
