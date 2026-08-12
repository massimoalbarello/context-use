# context-use

**A self-hosted brain for you. A public billboard for everyone else.**

Context Use gives your AI agents a private place to remember what they learn about you: who you are, what you care about, what you are working on, and how you like things done. Connect an agent over MCP and it can build and use this knowledge across conversations without handing control of it to someone else.

The same knowledge base can power a public version of you. Publish an introduction, ideas, projects, or anything else you want people to see while everything else stays private. Agents can help write and maintain the content, but only you can decide what becomes public.

The longer-term vision is an autobiography that writes itself. As Context Use connects to more of your personal data, it will turn your activity across the digital and physical world into an evolving life record. You choose which parts remain private and which parts become part of your public story.

## What it does

- Stores private Markdown pages with the five latest versions, plus any older snapshot that is still published.
- Organizes pages beneath first-class, linkable directories whose private and public indexes are generated from required one-sentence summaries; public indexes show folder metadata only for branches containing published knowledge.
- Gives personal agents read and write access through OAuth-protected MCP.
- Publishes only the exact pages and assets you approve.
- Manages named owner passkeys from Dashboard Settings, including hardware security keys and one-time enrollment links for another device.
- Lets only the dashboard owner permanently delete an archived page after fresh passkey confirmation.
- Exports a portable Markdown vault with page metadata, directory metadata, generated `index.md` files where navigation requires them, and local links. One-page leaf folders link directly to their sole page.
- Provides a public profile at `about/intro`, plus public pages for anything else you choose to share.
- Generates `/llms.txt`, `/llms-full.txt`, and a clean `.md` alternate for every page deterministically from only the explicitly published page projection.
- Publishes `/robots.txt`, a complete `/sitemap.xml`, canonical and social metadata, and structured profile identity derived from the published introduction and any optional contact links.
- Runs locally or on your own AWS account.

## Run locally

You only need Docker:

```sh
git clone https://github.com/massimoalbarello/context-use.git
cd context-use
docker compose up --build
```

Then open the [local setup page](http://localhost:5173/app#setup=development-owner-setup-token-0000000000000). The default owner email is `you@example.com`.

To use another email on a fresh installation:

```sh
OWNER_EMAIL=me@example.com docker compose up --build
```

When developing from this repository, the Bun shortcuts make the stack lifecycle easier:

```sh
bun run local up       # build, start, and wait until the app is ready
bun run local status   # show the development containers
bun run local logs     # follow their logs
bun run local down     # stop everything but preserve local data
bun run local reset    # erase knowledge/assets, preserve login, and restart
bun run local destroy  # erase knowledge/assets, preserve login, and leave it stopped
bun run local purge    # erase every volume, including owner and passkeys
```

`bun run local up` prints the app and owner-setup URLs when it is ready.

## Run the integration suites

Database integration suites commit fixtures and clean them up with trigger and
foreign-key enforcement suspended, so they run against a PostgreSQL server of their own
and refuse any database not named for disposal. Start one, run them, and throw it away:

```sh
bun run db:test up     # start and migrate a disposable PostgreSQL on 127.0.0.1:55432
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/context_use_test bun test apps packages
bun run db:test down   # discard it
```

Never point `TEST_DATABASE_URL` at the local stack above: these suites would delete the
owner identity it and the evals sign in with.

## Run knowledge evals locally

Knowledge evals use the same local instance. Start it with `bun run local up` and create
its owner once, then connect Codex and drive the activity distiller over a vendored
corpus with your local ChatGPT subscription:

```sh
bun run eval connect codex
bun run eval distill --window dense --days 2
```

The corpus is copied verbatim from [`garrytan/gbrain-evals`](https://github.com/garrytan/gbrain-evals)
and served through the production `read_source_records` tool, one automation run per
corpus day, so this exercises the real ingestion path rather than an eval-only prompt.
`bun run eval run` still runs the earlier hand-written trajectory with deterministic
scoring.

Each run resets local knowledge and assets before it starts, so do not keep development
data in this disposable instance. The owner, passkeys, sessions, and MCP OAuth grants
are preserved.

Add `--provider claude` after `claude auth login` to use Claude Code instead. Reports,
complete agent logs, and per-run snapshots are written beneath the gitignored
`.eval-results/` directory. `bun run eval score` deterministically rescores saved
scenario snapshots without using model credits, and `bun run eval corpus:verify` confirms
the corpus is unchanged. See [`eval/README.md`](eval/README.md) for details.

## Self-host on AWS

The CLI provisions and manages Context Use in your AWS account. You need an authenticated AWS CLI profile, Terraform 1.11+, GitHub CLI, and a hostname you control.

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/massimoalbarello/context-use/releases/latest/download/install.sh | sh

~/.local/bin/context-use setup
```

Follow the prompts for your AWS profile, region, hostname, DNS, and owner email. The CLI deploys the application, configures TLS, and gives you a one-time owner setup link. Use `context-use status`, `context-use update`, or `context-use doctor` to manage the installation later.

New installations receive the Git-versioned default knowledge template. Template changes are intentionally separate from software updates: use `context-use template plan` to preview missing directories and pages, safe updates, and local conflicts, then `context-use template apply` to apply them. Existing directories are never removed, local directory-presentation drift and locally edited guides and managed pages are preserved, and create-only state pages are structurally checked but never overwritten. A page explicitly listed in the template's `retired.json` is archived only while it remains unpublished and template-owned; published or locally modified pages are preserved for review. To replace eligible local directory metadata, active guides, and managed pages with the template, add `--force-template`. Preview with the same flag on `context-use template plan` before using it with `context-use template apply`.

## Nango data ingestion

AWS installations also run Nango on the same `t3.large` EC2 instance. Nango is the ingestion and encrypted-record layer. Each sync must transform provider responses into a provider-agnostic JSON envelope containing only `id`, `created_at`, `updated_at`, `participants`, and a complete semantic Markdown `body`. These records are the input to the downstream pipeline, so connection-specific fields, raw provider payloads, and unused API fields must not be saved outside the Markdown document. Nango records are not copied directly into the Context Use knowledge-page schema. The deployment uses Nango's full upstream image with enterprise mode enabled and runs its server, jobs, orchestrator, persist, and Redis services on isolated Docker networks. Nango shares the PostgreSQL container but owns a separate `nango` database through dedicated application and read-only backup roles. The record contract and required tests are documented in [`nango-integrations/SYNC_GUIDELINES.md`](nango-integrations/SYNC_GUIDELINES.md).

The Context Use dashboard registers Nango as a managed service and links to its dashboard at `https://nango.YOUR_HOST`. Open that link after signing in to Context Use. A fixed first-party OIDC client completes the same passkey session automatically, without a second account, passkey registration, or credential-retrieval command.

Runtime values are KMS-encrypted SecureString parameters below `/context-use/<installation-id>/<environment>/`. Nango's internal dashboard credential, admin key, encryption key, database credentials, OIDC client secret, and scoped deployer and pipeline API keys use dedicated values there. The CLI never reveals the internal dashboard credential. Controller operations run through Systems Manager and a route-allowlisted container-loopback channel; the public Nango edge does not accept those credentials. The pipeline key is injected only into the private MCP service, which reaches Nango over a dedicated internal Docker network.

The private Context Use MCP exposes `read_source_records` as the single downstream read
surface. It discovers every connection for each managed pipeline model and returns a
unified batch containing only a stable source reference, a source label, and the
record's lifecycle action and canonical Markdown. Every read applies a rolling 30-day
freshness window: records whose latest source update or deletion is older are omitted
while their cursors still advance. The window applies to source modification, not to the
activity date described by returned Markdown, so a recently updated record about older
activity is returned normally. Its `next_checkpoint` is one opaque cursor across all
connections and models, including connections discovered after earlier runs. Callers
must treat it as an indivisible value. Nango webhooks are not involved in downstream
processing, and Context Use does not create a second per-record observation store.

The Nango hostname is internet reachable because providers must call a small set of OAuth callback, Connect-session, and webhook endpoints. Those method/path combinations pass through a credential-free, default-deny public gateway. Every dashboard request instead passes through OAuth2 Proxy and a live Context Use owner-session check before an internal gateway injects Nango's Basic credential. The browser never receives that credential or the OIDC access token, and the outer edge has no network path to Nango itself.

### GitHub pull requests

Create a GitHub OAuth app with `https://nango.YOUR_HOST/oauth/callback` as its authorization callback URL, then run:

```sh
context-use nango integrations add
```

The command sends the prompted client ID and secret directly to Nango, creates or reconciles the `github` integration, and deploys the release-pinned `pull-requests` sync. It does not save those OAuth credentials locally or in SSM. Open the Nango dashboard afterward and create a GitHub connection. By default, the connection syncs pull requests from every accessible repository; set its metadata to `{"repositories":["owner/repository"]}` to limit the source set. GitHub's OAuth `repo` scope is required to include private repositories. Changing that source set stops future refreshes but intentionally does not delete existing records yet; retention and pruning will be introduced as a separate, explicit policy. Each saved PR has the universal pipeline envelope, while its Markdown body contains the PR description, status, branches, participants, change-size summary, commits, reviews, and discussion and code-review comments. Changed-file patches and unused GitHub API fields are discarded. A Markdown warning identifies the unusual case where GitHub caps the commit collection.

### Granola meeting summaries

Create the Granola integration in the Nango dashboard before running the managed
integration command. Choose **Granola (MCP)**, set the integration ID to `granola`, and
leave client credentials empty. The dashboard creation path performs Granola's dynamic
MCP client registration; Nango's public integration-management endpoint does not, so
Context Use intentionally refuses to create this integration automatically. Create a
Granola connection through Nango's browser OAuth flow, then run:

```sh
context-use nango integrations add
```

The hourly `meetings` sync uses only the free-tier-compatible `list_meetings` and
`get_meetings` MCP tools. Granola Basic exposes personal notes from the last 30 days.
Each `GranolaMeeting` record contains the meeting title, Granola's displayed date, a
source link, named attendees with stable email identifiers when available, and the
complete Granola-generated summary. Private notes and transcripts are not stored.

Inspect the managed state or redeploy the exact function version bundled with the installed Context Use release using:

```sh
context-use nango integrations status
context-use nango integrations deploy
```

`context-use update` updates the Nango runtime and installs the matching function-deployer image, but it does not mutate live functions automatically. Run the explicit deploy command when a release changes integration code. Destructive model changes remain blocked unless you deliberately pass `--allow-destructive`.

Nango gets an independent daily PostgreSQL backup stream in the retained backup bucket under `nango-postgres/`, encrypted with the installation KMS key and produced by the scoped `nango_backup` role. `context-use backup` captures both databases, while `context-use nango restore` restores only Nango. Compiled integration artifacts on the retained volume are reproducible rather than authoritative: keep integration source in version control and redeploy it after total-volume recovery. Application logs go to CloudWatch. Dozzle, Elasticsearch, and Nango's optional log backend are deliberately omitted until they provide enough value to justify their operational cost.

### Updating Nango

The `nango/` submodule points to the `context-use` branch of the personal [`massimoalbarello/nango`](https://github.com/massimoalbarello/nango) fork. The fork currently stays source-compatible with upstream; Context Use does not depend on Company Brain's Nango patches.

The gitlink is pinned so every Context Use release builds a reproducible Nango commit. The daily and manually runnable `Sync Nango submodule` workflow checks the fork's `context-use` branch, rejects non-fast-forward changes, and opens a pull request that advances the pin. Merge that pull request and publish or redeploy Context Use to roll out the new image; deployments never follow a moving branch directly.

## Connect an agent

Point any OAuth-capable agent or external automation harness at:

```text
https://YOUR_HOST/mcp
```

Context Use stores automation instructions and supporting assets as ordinary
private knowledge. An external harness such as OpenClaw can schedule a job that
reads a known instruction page with `get_page`—for example,
`automations/daily-fabric/instructions`—and then uses the ordinary knowledge and
asset tools. Scheduling, retries, and run history stay in the harness. An incremental
automation may keep exactly one non-secret opaque checkpoint on its stable `state` page.

### Knowledge automations

The default template installs managed instruction pages for activity distillation, diary
composition and guideline consistency review, with checkpoint state where required.
Apply template updates with `context-use template apply`, then schedule an external harness
to open and execute the relevant instruction page. Those pages are the canonical operating
contracts; the README does not duplicate their logic.

The dashboard's **History** section shows the same durable page ledger, including
creates, updates, archives, and deletion tombstones without page bodies or diffs.

MCP clients cannot publish knowledge; public access always remains an owner decision.

## License

MIT
