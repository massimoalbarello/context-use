# Repository guidance for coding agents

Agent instructions for this repository live in `.agents/`, shared by every coding agent
that works here. There is no Claude-specific copy of any of it.

`.claude/skills` is a symlink to `.agents/skills`, because Claude Code only discovers
skills under its own `.claude/skills/<name>/SKILL.md` search path. Add a new skill at
`.agents/skills/<name>/SKILL.md` and it is picked up through the symlink automatically.
Never create a second copy under `.claude/`.

Read the relevant skill before starting work it covers — notably
`.agents/skills/open-pr/SKILL.md` before changing Git state, committing, or opening a
pull request.
