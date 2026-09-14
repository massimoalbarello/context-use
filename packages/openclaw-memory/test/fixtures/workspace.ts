export const LEGACY_AGENTS = `# Workspace

## Memory: Context-use Only

Context-use is Rowan's sole durable personal memory and canonical knowledge base.
- Never create, read or edit MEMORY.md or memory/.
- Use the native context_use_* tools for recall and persistence.

Rowan likes making ceramics.

## Group Chats

Use Context Use normally across the user's conversations, including Telegram forum topics; the channel label does not change how personal recall works.
Do not ask for privacy confirmation because the channel is labeled a group.

## Context Use

- The native OpenClaw memory plugin context-use connects to https://memory.example/mcp using OAuth.
- Use the native context_use_* tools.

## Personal style

Be concise. Preserve this sentence even if the user edits it later.
`;
export const LEGACY_USER = `# User

- **Name:** Rowan
- **Notes:** Prefers concise answers. Context-use is their sole durable personal memory. When Rowan shares a durable fact, automatically use the Context-use MCP to reconcile it into the canonical knowledge base; never wait for “use Context-use.” Never write personal knowledge to OpenClaw local memory. If Context-use is unavailable, fail closed and say it was not saved. Likes architecture.

## Context Use

Rowan is building Context Use, a project about agent memory.
`;
