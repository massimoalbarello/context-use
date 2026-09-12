# Public Steve Jobs demo

This is a separate, anonymous, read-only application built on the
[Steve Jobs fixtures](../../../scripts/seeds/isolated-development/README.md). It lets visitors
browse the iPod-to-iPhone story, entities, page revisions, source records, and licensed assets
without connecting any personal information. Reconstructed first-person notes and invented
conversations retain the fixture's explicit provenance labels. The demo calendar treats
October 2007 as the present; timestamps and the machine's clock remain real.

From the repository root:

```sh
bun run demo:build:local
PORT=3001 bun run demo:start
```

Open http://localhost:3001. The single executable is
`apps/backend/demo/dist/context-use-demo`. It contains the frontend and seeded database/files;
it requires no source checkout or sidecar files at runtime. Restarting restores the bundled
snapshot. It does not read `DATA_FOLDER`, personal databases, auth secrets, or integrations.
Only `PORT` configures the demo listener.

## Hosting on nibrun

Build the Linux x64 executable, then create a dedicated demo app:

```sh
bun run demo:build
nib login
nib run apps/backend/demo/dist/context-use-demo --name steve-jobs-demo --port 3000
```

For subsequent deployments, use `--app <exact-demo-slug>` from `nib apps list` instead of
`--name`. Share the returned HTTPS URL; visitors need no account. Never deploy this binary over
a personal instance. The distinct app name also keeps it outside the personal deployment
script's `context-use-` app selection.

CI builds and boots the demo independently of the personal application. After merge to `main`,
the separate rolling `demo-latest` release publishes `context-use-demo`. The personal
`nibrun-latest` release and its build workflow remain unchanged. The README deploy button uses that
demo artifact.

## Isolation and enforcement

- Production `src/main.ts`, `src/app.ts`, authentication, and backend build remain unchanged.
  They never import this directory. There is no runtime switch to disable authentication.
- `build.ts` seeds a fresh database through existing services, using only checked-in fixtures.
  The seeder and migrations are not bundled into the demo runtime.
- `main.ts` extracts that snapshot into a fresh temporary directory and opens SQLite read-only.
  Its storage adapter rejects writes and deletes. Graceful shutdown removes the directory;
  the hosting environment discards temporary storage on restart.
- `app.ts` is the only HTTP entry point. Its outer gate accepts GET/HEAD for named resource reads
  and static/browsing paths. Every other method or route is rejected before controller dispatch.
  Auth, MCP, sync, ingestion, and transfer controllers are not mounted. The session metadata
  endpoint returns a public display identity and creates no cookies or login sessions.
- The frontend's explicit demo Vite configuration replaces the presentation policy and calendar
  module. The default frontend policy retains personal editing and account controls. UI hiding
  is not the security boundary; direct write requests also fail.

`bun --filter @repo/backend test demo` verifies anonymous reads, denied writes and management
routes, unchanged database/file fingerprints, read-only persistence, and normal authentication.
`bun run demo:check` boots the compiled executable with a sentinel personal data folder and
checks the actual HTTP boundary and cleanup. Use a host build when running it locally.
