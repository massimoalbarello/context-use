# context-use

**A self-hosted brain for you. A public billboard for everyone else.**

You already produce the raw material of a life story every day. Meetings happen, pull requests
get merged, trips get booked, decisions get made in conversations with your agents. Almost none
of it gets written down, and the little that does ends up scattered across a dozen tools that
each know one small thing about you and nothing about the rest.

Context Use is where all of it lands.

## An autobiography that writes itself

Your agents write to Context Use directly: what you're working on, how you like things done,
what you decided and why. Data connections fill in everything else — meetings, pull requests,
and more as they're added — without you typing a word.

Nothing about this is a chore. You go about your life, and the record accumulates.

## A web, not a pile of notes

A transcript dump would be useless. Context Use pulls the people, companies, events, meetings,
trips, and tasks out of your activity and links them to each other, so the same person appears
in the meeting where you met them, the company they moved to, and the project you started
together.

The nuance lives in the connections. Following them is how you — or an agent — find the thing
you half-remember.

## Structure that holds up

Left alone, an agent will happily turn a knowledge base into a landfill. Context Use ships a
versioned knowledge template that tells agents where things go, how pages are summarized, and
when to write a new page instead of appending to an old one.

The result stays navigable at ten pages and at ten thousand.

## Private by default, public by choice

Everything is private. It runs on your machine or in your AWS account, and your agents reach it
over OAuth-protected MCP — no third party in between.

From that same knowledge base you can publish a public version of yourself: an introduction,
your ideas, your projects, whatever you want the world (and its crawlers) to see. Agents can
draft public pages, but they cannot publish. Only you decide what leaves the private side.

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

Point any OAuth-capable agent at:

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
