<div align="center">
  <img src="apps/frontend/src/assets/context-use.svg" alt="Context Use logo" width="128" height="128" />
  <h1>Context Use</h1>
  <p><em>Personal hypermedia for human-agent collaboration.</em></p>

[![Deploy on nibrun](https://nibrun.com/button.svg)](https://app.nibrun.com/deploy?name=context-use&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fcontext-use%2Freleases%2Fdownload%2Fnibrun-latest%2Fcontext-use&port=3000&minimal)

</div>

## Run it locally
```sh
bun install
cp apps/backend/.env.example apps/backend/.env
bun run dev
```
Open [http://localhost:5173](http://localhost:5173). The first person to register a passkey becomes
the owner of the instance. Context Use generates its auth secret inside the configured `data/`
directory; set `BETTER_AUTH_SECRET` only when you need to supply your own.

To explore Steve Jobs' context from iPod to iPhone (2001–2007), run
`bun run dev:isolated:seeded` with Chrome and browser-harness available. Stop the ordinary dev server
first. The command registers a real passkey and loads the story into temporary storage, which is
deleted when it stops.

## Deploy it on nibrun

[nibrun](https://github.com/ilbertt/nibrun) runs Context Use as one small server with an HTTPS URL
and persistent storage. Use the button above for the first deployment, then update that same app
with the CLI. Install it and sign in once:
```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
```
Create or update your instance:
```sh
bun run deploy:nibrun
```
The command builds the Linux binary and creates a configured Context Use app on its first run. Each
later run deploys onto that same app. Your database, uploaded files, OAuth credentials, and generated
auth secret live in nibrun's persistent `/app/data` directory, so clients stay authorized across
updates and restarts.
