# Steve Jobs demo

An anonymous, read-only demo using the [Steve Jobs fixtures](../../scripts/seeds/isolated-development).
It reuses the application's logic and UI through a separate build; production authentication stays unchanged.
The server blocks writes and MCP and account actions, and reads only its bundled snapshot, ignoring `DATA_FOLDER`.

Run these commands from the repository root.

## Local preview

```sh
BUILD_TARGET=host bun run build:demo
PORT=3001 apps/demo/dist/context-use-demo
```

Open http://localhost:3001. The executable at `apps/demo/dist/context-use-demo`
contains the frontend, database, and files.

## Deploy to nibrun

```sh
nib login
bun run deploy:demo --name steve-jobs-demo
```

For redeployment, use `bun run deploy:demo --app <existing-slug>`.

## Verify

Run `bun --filter @repo/demo test:binary` after a local build to check the executable's bundled resources,
write rejection, and isolation from personal data. CI runs this check but never publishes or deploys the demo.
