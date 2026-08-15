# context-use

**A self-hosted brain for you. A public billboard for everyone else.**

Context Use is a self-hosted knowledge base that your AI agents read and write over MCP. It
accumulates what you're working on, who you work with, and how you like things done, and it can
publish a public version of any part of it.

## It writes itself

Two things feed it. Your agents write to it directly — decisions, preferences, context from
whatever you're doing with them. Data connections write to it indirectly: meetings, pull
requests, and more as integrations are added. You don't maintain it by hand.

## Everything is linked

Context Use extracts the people, companies, events, meetings, trips, and tasks out of that
activity and links them to each other. A person's page connects to the meeting where you met
them, the company they work at, and the project you started together. You navigate by following
those links, and so do your agents.

## Agents keep it organized

A versioned knowledge template tells agents where each kind of page belongs, how it's
summarized, and when to create a new page instead of extending an old one. That's what keeps a
knowledge base this size usable rather than a pile of notes.

## Private by default

It runs on your machine or in your AWS account, and agents reach it over OAuth-protected MCP.
Nothing goes through a third party.

You can publish selected pages — an introduction, your projects, your ideas — as a public
profile. Agents can draft those pages but cannot publish them. That decision is always yours.

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

To run it on your own machine instead, see [Development](docs/development.md).

## Connect an agent

Point any MCP-capable agent at:

```text
https://YOUR_HOST/mcp
```

## Ingest your data

AWS installations run Nango to sync data from providers such as GitHub and Granola into your
knowledge base. See [`docs/nango.md`](docs/nango.md).

## Documentation

- [Development](docs/development.md) — running locally, tests, and knowledge template updates.
- [Data ingestion](docs/nango.md) — Nango setup, integrations, and operations.
- [Evals](eval/README.md) — knowledge quality evaluation.
- [Security](SECURITY.md)

## License

MIT
