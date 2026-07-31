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

New installations receive the Git-versioned default knowledge template. Template changes are intentionally separate from software updates: use `context-use template plan` to preview missing guides, safe updates, and local conflicts, then `context-use template apply` to apply them. Existing directories are never removed, and guides edited inside an instance are preserved.

> **Schema compatibility:** the directory/index release intentionally replaces the pre-release migration history with one checksummed baseline. Existing installations must be destroyed with retained data and recreated; the migrator rejects older or modified schemas instead of starting against an incompatible database.

## Nango data ingestion

AWS installations also run Nango on the same `t3.large` EC2 instance. Nango is the ingestion and encrypted-record layer; its raw records are not copied into the Context Use knowledge-page schema. The deployment uses Nango's full upstream image with enterprise mode enabled and runs its server, jobs, orchestrator, persist, and Redis services on isolated Docker networks. Nango shares the PostgreSQL container but owns a separate `nango` database through dedicated application and read-only backup roles.

The Context Use dashboard registers Nango as a managed service and links to its dashboard at `https://nango.YOUR_HOST`. Show the username and URL with:

```sh
context-use nango credentials
```

Reveal the generated dashboard password only when you need to log in:

```sh
context-use nango credentials --reveal
```

Runtime values are KMS-encrypted SecureString parameters below `/context-use/<installation-id>/<environment>/`. Nango's dashboard credentials, admin key, encryption key, database credentials, and scoped deployer and pipeline API keys use `NANGO_*` names there. The credentials command intentionally exposes only the dashboard login; service keys remain internal.

The Nango hostname is internet reachable so providers can call OAuth callback and webhook endpoints. The dashboard is gated by Nango's native username/password authentication, but a blanket proxy login in front of the entire hostname would also block those public integration endpoints. Keep access control route-aware if it is tightened later.

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
asset tools. Scheduling, retries, and run history stay in the harness.

MCP clients cannot publish knowledge; public access always remains an owner decision.

## License

MIT
