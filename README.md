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

## Self-host on AWS

The CLI provisions and manages Context Use in your AWS account. You need an authenticated AWS CLI profile, Terraform 1.11+, GitHub CLI, and a hostname you control.

```sh
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/massimoalbarello/context-use/releases/latest/download/install.sh | sh

~/.local/bin/context-use setup
```

Follow the prompts for your AWS profile, region, hostname, DNS, and owner email. The CLI deploys the application, configures TLS, and gives you a one-time owner setup link. Use `context-use status`, `context-use update`, or `context-use doctor` to manage the installation later.

New installations receive the Git-versioned default knowledge template. Template changes are intentionally separate from software updates: use `context-use template plan` to preview missing guides, safe updates, and local conflicts, then `context-use template apply` to apply them. Existing directories are never removed, and guides edited inside an instance are preserved. To replace active local guides deliberately, preview with `context-use template plan --overwrite-guides`, then run `context-use template apply --overwrite-guides`.

## Nango data ingestion

AWS installations also run Nango on the same `t3.large` EC2 instance. Nango is the ingestion and encrypted-record layer. Each sync must transform provider responses into a provider-agnostic JSON envelope containing only `id`, `created_at`, `updated_at`, `participants`, and a complete semantic Markdown `body`. These records are the input to the downstream pipeline, so connection-specific fields, raw provider payloads, and unused API fields must not be saved outside the Markdown document. Nango records are not copied directly into the Context Use knowledge-page schema. The deployment uses Nango's full upstream image with enterprise mode enabled and runs its server, jobs, orchestrator, persist, and Redis services on isolated Docker networks. Nango shares the PostgreSQL container but owns a separate `nango` database through dedicated application and read-only backup roles. The record contract and required tests are documented in [`nango-integrations/SYNC_GUIDELINES.md`](nango-integrations/SYNC_GUIDELINES.md).

The Context Use dashboard registers Nango as a managed service and links to its dashboard at `https://nango.YOUR_HOST`. Show the username and URL with:

```sh
context-use nango credentials
```

Reveal the generated dashboard password only when you need to log in:

```sh
context-use nango credentials --reveal
```

Runtime values are KMS-encrypted SecureString parameters below `/context-use/<installation-id>/<environment>/`. Nango's dashboard credentials, admin key, encryption key, database credentials, and scoped deployer and pipeline API keys use `NANGO_*` names there. The credentials command intentionally exposes only the dashboard login; service keys remain internal. The pipeline key is injected only into the private MCP service, which reaches Nango over a dedicated internal Docker network.

The private Context Use MCP exposes `read_source_records` as the single downstream read
surface. It discovers every connection for each managed pipeline model and returns a
unified batch containing only a stable source reference, a source label, and the
record's lifecycle action and canonical Markdown. Each newly discovered source stream
starts with records modified during the preceding 30 days; older history is intentionally
excluded. Its `next_checkpoint` is one opaque cursor across all connections and models,
including connections discovered after earlier runs. Callers must treat it as an
indivisible value. Nango webhooks are not involved in downstream processing, and Context
Use does not create a second per-record observation store.

The Nango hostname is internet reachable so providers can call OAuth callback and webhook endpoints. The dashboard is gated by Nango's native username/password authentication, but a blanket proxy login in front of the entire hostname would also block those public integration endpoints. Keep access control route-aware if it is tightened later.

### GitHub pull requests

Create a GitHub OAuth app with `https://nango.YOUR_HOST/oauth/callback` as its authorization callback URL, then run:

```sh
context-use nango integrations add
```

The command sends the prompted client ID and secret directly to Nango, creates or reconciles the `github` integration, and deploys the release-pinned `pull-requests` sync. It does not save those OAuth credentials locally or in SSM. Open the Nango dashboard afterward and create a GitHub connection. By default, the connection syncs pull requests from every accessible repository; set its metadata to `{"repositories":["owner/repository"]}` to limit the source set. GitHub's OAuth `repo` scope is required to include private repositories. Changing that source set stops future refreshes but intentionally does not delete existing records yet; retention and pruning will be introduced as a separate, explicit policy. Each saved PR has the universal pipeline envelope, while its Markdown body contains the PR description, status, branches, participants, change-size summary, commits, reviews, and discussion and code-review comments. Changed-file patches and unused GitHub API fields are discarded. A Markdown warning identifies the unusual case where GitHub caps the commit collection.

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

### Activity distillation automation

The first record-to-knowledge pipeline is intentionally agent-driven. Create
`automations/activity-distiller/instructions` and
`automations/activity-distiller/state`, authorize its trusted MCP client, and schedule
its harness once or twice a day. Its run contract is:

1. Read the instruction and state pages, call `read_source_records` with the stored
   checkpoint, and process exactly that bounded batch. Do not accumulate multiple
   batches in one model context; a newly discovered source begins with the last 30 days.
2. Interpret all source Markdown together. Connections are provenance, not page
   boundaries: records from different services can describe or corroborate the same
   day, project, decision or entity. Treat a `deleted` action as withdrawn evidence,
   not as current source material.
3. Search and read existing knowledge before writing. Reconcile new evidence into the
   current canonical account by rewriting and reorganizing it; merge overlaps, remove
   superseded detail, and create a new semantic page only when no existing subject fits.
4. Put only material temporal activity on at most one automation-owned diary page for
   each date when it actually happened, with links to its projects, tasks and useful
   entities. Omit routine activity. Never put cursors, run metadata or one page per
   source in the diary.
5. Create project, task, person and company pages selectively. Repetition and material
   involvement can justify an entity; a participant list, repository name or isolated
   record cannot.
6. Replace the stable state page with the final opaque checkpoint only after every
   intended knowledge write succeeds. Leave it unchanged on failure so the input can be
   replayed safely. If `has_more` is true, let the harness begin a fresh bounded run from
   the saved checkpoint.

The default knowledge template carries the detailed placement and maintenance rules,
including `about/projects/` for enduring work, finite future-facing frames under
`about/tasks/`, and whole-page reconciliation instead of append-only updates.

MCP clients cannot publish knowledge; public access always remains an owner decision.

## License

MIT
