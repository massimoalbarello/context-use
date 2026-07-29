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

> **Schema compatibility:** the directory/index release intentionally replaces the pre-release migration history with one checksummed baseline. Existing installations must be destroyed with retained data and recreated; the migrator rejects older or modified schemas instead of starting against an incompatible database.

## Connect an agent

For an interactive agent that reads and manages knowledge, point any OAuth-capable MCP client at:

```text
https://YOUR_HOST/mcp
```

For a dedicated worker that reads knowledge and executes scheduled runs with run-scoped writes, use:

```text
https://YOUR_HOST/mcp/execution
```

Authorize the two connections separately. Neither connection can publish knowledge; public access always remains an owner decision.

## License

MIT
