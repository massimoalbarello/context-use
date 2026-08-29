# bun-monorepo-starter

A Bun and Turborepo monorepo with a full-stack starter application adapted from
[bun-full-stack-starter](https://github.com/ilbertt/bun-full-stack-starter).

## Structure

```text
apps/
  backend/            # Elysia API and production binary
  frontend/           # React SPA and typed API client
packages/
  my-package/         # Publishable npm package template
  pack-utils/         # Internal package build utilities
  typescript-config/  # Shared TypeScript configuration
```

The frontend consumes the backend's exported application type through the workspace, while the
shared package configuration remains available to every current and future app or package.

## Getting started

```bash
bun install
cp apps/backend/.env.example apps/backend/.env
openssl rand -base64 32 # paste into BETTER_AUTH_SECRET in apps/backend/.env
bun run dev
```

Vite serves the app on `http://localhost:5173` and proxies API requests to the backend on `:3000`.
The backend is API-only during development so it cannot expose a stale frontend under a different
authentication origin. The starter includes passkey-only authentication, SQLite migrations, file
storage, OpenAPI, and a production build that embeds the frontend and migrations in one binary. The
first verified passkey claims the instance owner; later sign-ins use that passkey without an email
address or password.

## Build

```bash
bun run build
```

Turborepo builds the workspace in the required order. The deployable binary is written to
`apps/backend/dist/app`; `bun run build:local` targets the current machine instead of Linux x64.

## Tooling

- [Bun](https://bun.sh) — runtime, package manager, and bundler
- [Turborepo](https://turborepo.dev/) — workspace task orchestration and caching
- [Biome](https://biomejs.dev/) — linting and formatting
- [TypeScript](https://www.typescriptlang.org/) — shared through `@repo/typescript-config`
- [commitlint](https://commitlint.js.org/) — Conventional Commit enforcement

## Contributing

Read the [contribution guide](./.github/CONTRIBUTING.md) before opening a pull request.
