# Steve Jobs demo

An anonymous, read-only demo using the [Steve Jobs fixtures](../../../scripts/seeds/isolated-development).
It reuses the application's logic and UI through a separate build; production authentication stays unchanged.
The server blocks writes and MCP and account actions, and reads only its bundled snapshot, ignoring `DATA_FOLDER`.

Run these commands from the repository root.

## Local preview

```sh
bun run demo:build:local
PORT=3001 bun run demo:start
```

Open http://localhost:3001. The executable at `apps/backend/demo/dist/context-use-demo`
contains the frontend, database, and files.

## Deploy to nibrun

```sh
nib login
bun run demo:deploy:nibrun
```

This builds and creates or updates the `steve-jobs-demo` app. Add its public URL to the root README.

## Verify

Run `bun run demo:check` after a local build to check the executable's bundled resources,
write rejection, and isolation from personal data. CI runs this check but never publishes or deploys the demo.
