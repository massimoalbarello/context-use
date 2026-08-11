# Skills conventions

Follow the [[agents|root guide]] for every convention not specific to skills. This guide
adds the metadata and body contract needed for discoverable skills.

## Discoverable shape

Use one immediate page at `skills/<skill-name>`, where `<skill-name>` is kebab-case.
Skills are a local exception to the root entity-folder default: the runtime discovers
these immediate pages directly, so do not wrap a skill in a folder or add an `intro`.
Three values work together:

1. The page metadata title is exactly `SKILL.md`.
2. The page path leaf and YAML frontmatter `name` are exactly equal.
3. The page metadata summary is the discovery mechanism. It says what the skill does
   and includes the natural phrasings that should trigger it. Keep the YAML
   `description` aligned with that summary, usually by using the same text.

These are functional discovery constraints rather than stylistic preferences. An agent
uses the metadata summary to decide whether to load the page; trigger-poor or drifting
metadata makes the skill effectively invisible.

The page body is the complete skill, opening with the frontmatter that carries those values:

    ---
    name: <skill-name>
    description: <what it does and the phrasings that should trigger it>
    ---

Below it, write what an agent needs in order to use the skill: when to reach for it, how to
carry it out, and what it should produce. How that divides into headings follows the skill —
a fixed procedure and a judgement call with no fixed procedure do not want the same page.

Page history provides versioning, so another copy is unnecessary.

## Skill-specific guidance

A skill is loaded by an agent working **with** the owner. An unattended scheduled
workflow instead follows [[automations/agents|the automation guide]].

State the paths or other resources the skill may change and the output it produces,
such as a chat answer, page or file. Let the skill link the applicable guide rather than
copying knowledge-base conventions into its body.
