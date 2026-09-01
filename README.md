# Context Use

[![Deploy on nibrun](https://nibrun.com/button.svg)](https://app.nibrun.com/deploy?name=context-use&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fcontext-use%2Freleases%2Fdownload%2Fnibrun-latest%2Fcontext-use&port=3000&minimal)

Context Use is personal hypermedia for human-agent collaboration.

## Run it locally
```sh
bun install
cp apps/backend/.env.example apps/backend/.env
bun run dev
```
Open [http://localhost:5173](http://localhost:5173). The first person to register a passkey becomes
the owner of the instance. Context Use generates its auth secret inside the configured `data/`
directory; set `BETTER_AUTH_SECRET` only when you need to supply your own.

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

Do not use the deploy button again to update an existing instance: a new nibrun app has a new
hostname and persistent volume, so it is a distinct OAuth server and clients must authorize it
separately.
