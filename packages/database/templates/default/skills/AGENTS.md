# Skills conventions

**One page per skill** at `skills/<skill-name>` — kebab-case — whose body is a complete
`SKILL.md`. Page history is the versioning; there is no other copy.

    ---
    name: <skill-name>
    description: <what it does, and the phrasings that should trigger it>
    ---

    # <Skill name>

    ## Use when
    ## Method
    ## Output

**This is a deliberate flat-page directory**, the stated deviation from
[[agents#entities-are-folders-and-views-are-pages|the root entity rule]]: a skill is
loaded whole, by name, and the loaded thing is the page body. Adding a folder around it
would put an `intro` between the agent and the instructions it came for.

Promote one to `skills/<skill-name>/` only when a skill genuinely needs supporting
material of its own — a template, a reference file, a worked example too long to inline.
Keep the `SKILL.md` at `intro`, and verify the skill still loads under the new path
before relying on it.

A skill is loaded by an agent working **with** the owner. An automation runs unattended
on a schedule in an external harness and lives in [[automations|`automations/`]] instead
— the difference matters, because an automation writes without a preview and a skill
does not.

## Local rules

- **The `description` is the whole retrieval mechanism.** It is all an agent sees when
  deciding whether to load the skill, so it states what the skill does *and* the phrasings
  that should trigger it, including the ones that don't name the tool. A description that
  only describes gets skipped.
- **A skill assumes this base, it does not restate it.** Link [[agents|the root guide]] or
  the relevant directory guide rather than copying rules in — a skill carrying its own
  copy of the naming convention is one more thing to drift.
- **Name what the skill may write.** A skill that creates pages states the paths it may
  create, in the skill itself, and stays inside them.
- **Say what the skill outputs**: a chat answer, a page, a file. A skill whose output is
  ambiguous produces a different thing every run.
