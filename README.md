# Context Use

[![Deploy on nibrun](https://nibrun.com/button.svg)](https://app.nibrun.com/deploy?name=context-use&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fcontext-use%2Freleases%2Fdownload%2Fnibrun-latest%2Fcontext-use&port=3000&env=BETTER_AUTH_SECRET&minimal)

Context Use is personal hypermedia for human-agent collaboration.

## Run it locally
```sh
bun install
cp apps/backend/.env.example apps/backend/.env
openssl rand -hex 32 # paste into BETTER_AUTH_SECRET in apps/backend/.env
bun run dev
```
Open [http://localhost:5173](http://localhost:5173). The first person to register a passkey becomes
the owner of the instance.

## Deploy it on nibrun

[nibrun](https://github.com/ilbertt/nibrun) runs Context Use as one small server with an HTTPS URL
and persistent storage. Use the button above to deploy the latest build, or install its CLI and
sign in once:
```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
```
Create or update your instance:
```sh
bun run deploy:nibrun
```
The command builds the Linux binary and creates a configured Context Use app on its first run. Each
later run deploys onto that same app. Your database and uploaded files live in nibrun's persistent
`data/` directory.
