# context-use

**A self-hosted brain for you. A public billboard for everyone else.**

Context Use gives your AI agents a private place to remember what they learn about you: who
you are, what you care about, what you are working on, and how you like things done. Connect
an agent over MCP and it can build and use that knowledge across conversations without handing
control of it to someone else.

The same knowledge base can power a public version of you. Publish an introduction, ideas,
projects, or anything else you want people to see, while everything else stays private. Agents
can help write the content, but only you decide what becomes public.

## What you get

- Private Markdown pages, organized in directories, with version history.
- Read and write access for your agents through OAuth-protected MCP.
- Publishing that covers only the exact pages and assets you approve.
- A public profile at `about/intro`, plus `llms.txt`, sitemap, and clean `.md` views of
  published pages.
- Passkey-owned accounts, portable Markdown exports, and full restorable archives.
- Runs locally or on your own AWS account.

## Run locally

You only need Docker:

```sh
git clone https://github.com/massimoalbarello/context-use.git
cd context-use
docker compose up --build
```

Then open the [local setup page](http://localhost:5173/app#setup=development-owner-setup-token-0000000000000).
The default owner email is `you@example.com`; set `OWNER_EMAIL` to use another one on a fresh
installation.

## Self-host on AWS

You need an authenticated AWS CLI profile, Terraform 1.11+, GitHub CLI, and a hostname you
control.

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/massimoalbarello/context-use/releases/latest/download/install.sh | sh
```

```sh
~/.local/bin/context-use setup
```

Follow the prompts for your AWS profile, region, hostname, DNS, and owner email. The CLI
deploys the application, configures TLS, and gives you a one-time owner setup link. Manage the
installation later with `context-use status`, `context-use update`, and `context-use doctor`.

## Connect an agent

Point any OAuth-capable agent at:

```text
https://YOUR_HOST/mcp
```

Agents can read and write knowledge, but they cannot publish it — public access always remains
an owner decision.

## Ingest your data

AWS installations run Nango to sync data from providers such as GitHub and Granola into your
knowledge base. See [`docs/nango.md`](docs/nango.md).

## Documentation

- [Development](docs/development.md) — local stack commands, tests, and knowledge template
  updates.
- [Data ingestion](docs/nango.md) — Nango setup, integrations, and operations.
- [Evals](eval/README.md) — knowledge quality evaluation.
- [Security](SECURITY.md)

## License

MIT
