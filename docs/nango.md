# Data ingestion (Nango)

AWS installations run [Nango](https://nango.dev) to sync data from providers into your knowledge
base. Each sync transforms provider responses into a provider-agnostic record containing `id`,
`created_at`, `updated_at`, `participants`, and a semantic Markdown `body`. Raw provider payloads
are discarded. The full contract is in
[`nango-integrations/SYNC_GUIDELINES.md`](../nango-integrations/SYNC_GUIDELINES.md).

The private Context Use MCP exposes `read_source_records` as the single downstream read surface.
It returns one bounded working set across every connection with one opaque `next_checkpoint`
cursor, and applies a rolling 30-day freshness window based on when a record was last updated at
the source. Large agent conversations are delivered losslessly over ordered fresh-session working
sets; each continuation repeats a small, labelled tail solely to interpret the new excerpt.

The Context Use dashboard links to Nango at `https://nango.YOUR_HOST`. Open it after signing in
to Context Use — your passkey session carries over, so there is no second account to create.

## GitHub pull requests

Create a GitHub OAuth app with `https://nango.YOUR_HOST/oauth/callback` as its authorization
callback URL, then run:

```sh
context-use nango integrations add --integration github
```

Open the Nango dashboard afterward and create a GitHub connection. By default it syncs pull
requests from every accessible repository; set the connection metadata to
`{"repositories":["owner/repository"]}` to limit the source set. GitHub's OAuth `repo` scope is
required to include private repositories.

Each saved PR's Markdown body contains the description, status, branches, participants,
change-size summary, commits, reviews, and comments. File patches are discarded.

## Granola meeting summaries

Create the Granola integration in the Nango dashboard first: choose **Granola (MCP)**, set the
integration ID to `granola`, and leave client credentials empty. Only the dashboard path performs
Granola's dynamic MCP client registration, so Context Use cannot create this integration for you.
Create a connection through Nango's OAuth flow, then run:

```sh
context-use nango integrations add --integration granola
```

The hourly `meetings` sync uses the free-tier-compatible `list_meetings` and `get_meetings` tools.
Granola Basic exposes personal notes from the last 30 days. Each record contains the meeting
title, date, source link, attendees, and the Granola-generated summary. Private notes and
transcripts are not stored.

## Managing integrations

```sh
context-use nango integrations status
```

```sh
context-use nango integrations deploy
```

Both cover every configured integration and accept `--integration <id>` to narrow to one.

`context-use update` updates the Nango runtime but does not mutate live functions — run `deploy`
explicitly when a release changes integration code. Destructive model changes are blocked unless
you pass `--allow-destructive`.
