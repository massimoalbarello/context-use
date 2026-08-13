# Interactive story runner

The story runner evaluates knowledge mutations after each turn of a short, persistent
conversation. Fixtures describe meaning; they do not prescribe storage.

## Fixture contract

A story contains:

- logical subjects such as `apple`, `designReview`, or `iphone`, described by kind plus
  identifying evidence;
- dated user turns, rendered exactly as conversation input beneath a visible date header;
- atomic expectations about identity, facts, links, timelines, reconciliation, hygiene,
  and—only where explicitly requested—tool activity.

Logical subjects never contain canonical paths or filenames. Their kind does carry the
template's placement contract: people must resolve under `people/`, organizations under
`companies/`, meetings under the dated `meetings/` hierarchy, and events under the dated
`events/` hierarchy. The scorer adds those placement checks automatically for subjects
active in each turn.

The agent receives no expected slugs, titles, assertions, or organization instructions.
Knowledge-write guidance comes from the default template's real `AGENTS.md` chain through
Context Use.

## Resolution and scoring

After every turn the runner snapshots stable directory and page IDs, versions, content,
and wikilinks. The resolver binds each logical subject to the best graph candidate using
its kind, names and aliases, date, distinguishing concepts, and links to already resolved
subjects. A binding follows the stable database ID if the agent later renames or moves it.

This deliberately accepts different valid shapes within those semantic boundaries. For
example, a product can resolve to an aspect page inside its company or to its own entity
folder; an occurrence title and slug can be whatever the agent chose, but a meeting cannot
silently pass from `topics/`. Equal plausible matches are reported as ambiguous instead of
arbitrarily selecting one.

Every expectation scores from 0 to 1 and remains visible in the JSON and Markdown reports.
Missing terms and timeline components receive proportional credit, while broken links and
failed lifecycle updates stay independently measurable. The overall score is an aggregate,
not a pass/fail gate, and dimension scores make regressions diagnosable.

## Run modes

- Suite mode resets once, preserves the knowledge base across all selected stories, and
  opens a fresh conversation per story. `--repeat` starts each suite repetition from a new
  reset so separate story sets cannot leak knowledge into one another.
- Journey mode has the same reset boundary but selects the suite's historical stories in
  chronological order. Reused canonical entities receive creation credit; ambiguous
  matches remain visible to identity and hygiene scoring.

Each run writes initial and per-turn snapshots, resolver evidence, tool traces, assertion
scores, agent logs, and a final report under `.eval-results/stories/`.
