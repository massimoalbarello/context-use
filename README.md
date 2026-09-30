<div align="center">
  <h1><img src="packages/ui/src/assets/context-use.svg" alt="" width="32" height="32" align="absmiddle" /> Context Use</h1>
  <p><em>All your context, shared by you and your agents.</em></p>

  <img src=".github/assets/context-use-logo.gif" alt="Context Use logo illuminated by orbiting warm light" width="720" height="405" />

[**View the Steve Jobs demo**](https://demo.context-use.com)

[![Deploy your own](.github/assets/deploy-your-own.svg)](https://app.nibrun.com/deploy?name=context-use&binary=https%3A%2F%2Fgithub.com%2Fmassimoalbarello%2Fcontext-use%2Freleases%2Fdownload%2Fnibrun-latest%2Fcontext-use&port=3000&minimal)

</div>

## Run it locally
```sh
bun install
cp apps/context-use/.env.example apps/context-use/.env
bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The first person to register a passkey becomes
the owner of the instance. Context Use generates its auth secret inside the configured `data/`
directory; set `BETTER_AUTH_SECRET` only when you need to supply your own.

Local face recognition is optional. To enable it, run
`bun --filter @repo/context-use build:faces:host` with CMake 3.24+ and a C++ toolchain installed.

## Deploy it on nibrun

[nibrun](https://github.com/ilbertt/nibrun) runs Context Use as one small server with an HTTPS URL
and persistent storage. Use the button above for the first deployment, then update that same app
with the CLI. Install it and sign in once:
```sh
curl -fsSL https://nibrun.com/install.sh | sh
nib login
```
To deploy a new context-use instance: `bun run deploy:instance --new <app-name>`. The you can update
an existing app using `--app <app-name>`.
