# Vendored evaluation corpora

Both corpora here are copied **verbatim** from [`garrytan/gbrain-evals`][upstream] and are
never edited. Everything Context Use adds about them — expected entities, questions,
scoring, Markdown rendering — lives outside this directory and is keyed by each corpus's
own item slugs.

| | `amara-life-v1` | `world-v1` |
| --- | --- | --- |
| Upstream | `garrytan/gbrain-evals` | `garrytan/gbrain-evals` |
| Commit | `565b80754ffa6abb9afb041026f2fab048aa7553` | `565b80754ffa6abb9afb041026f2fab048aa7553` |
| Committed | 2026-06-03 | 2026-06-03 |
| Path | `eval/data/amara-life-v1` | `eval/data/world-v1` |
| License | MIT (see the upstream repository) | MIT (see the upstream repository) |
| Files | 58 | 242 |

Both are pinned separately even though they come from one commit, because they are
independent experiments and re-pinning one must not silently move the other.

## Refreshing them

```sh
bun run eval corpus:verify [--corpus <id>]    # hash the working copy against the lockfile
bun run eval corpus:refresh [--corpus <id>]   # re-extract the pinned commit and report differences
```

`corpus:refresh` never rewrites the working copy. It reports a difference so that
re-pinning is a deliberate commit with a visible diff, because changing a corpus
invalidates every score measured against the previous one.

## `amara-life-v1` — raw activity

418 items over 47 days. This is the corpus that matches what Context Use actually does:
raw source material in, knowledge out.

| Type | Items | Span |
| --- | --- | --- |
| Slack | 300 | 13–17 April 2026 |
| Email | 50 | 13–20 April 2026 |
| Note | 40 | 25 January – 13 April 2026, every second day |
| Calendar event | 20 | 14–18 April 2026 |
| Meeting | 8 | 13–19 April 2026 |

Thirty-nine days hold a single note each. The remaining eight days, 13–20 April, hold 379
of the 418 items, which is why they are selectable as the `dense` window.

`corpus-manifest.json` ships upstream `content_sha256` values for all 418 items. Notes and
meetings are one file per item, so their hashes are reproduced directly and are checked on
every load. Emails, Slack messages and calendar events are many items inside one file;
upstream hashes those per item under a scheme that is not documented and could not be
reproduced, so those three files are covered file-by-file by the lockfile instead.

`doc/` holds six reference documents that are **not** in the upstream manifest and are
therefore never served. That matches upstream's own definition of the corpus.

## `world-v1` — already-distilled pages

240 pages: 80 people, 80 companies, 50 meetings, 30 concepts. Each is a JSON shard
carrying prose (`compiled_truth`, median 2.2 KB, plus a dated `timeline`) and a `_facts`
block of canonical relationships.

**`_facts` is answer key and is never served.** The loader strips it before rendering, the
way upstream's own `sanitizePage()` does, and a test asserts no `_facts` value reaches a
record body. It is the source of the 145 questions in [../qa/world-v1](../qa/world-v1).

Two files are vendored but never served: `_ledger.json` (generation cost metadata) and
`world.html` (a rendered explorer). Neither is content, and both are kept because the
corpus is copied verbatim.

This corpus tests a **different and easier task** than `amara-life-v1`: its pages are
already someone's finished knowledge base, so distilling them exercises prose
reconciliation and retrieval but not extraction from raw email and Slack. It is here
because it is the only corpus upstream ships with a populated answer key.

## Entity references

Both corpora write entity references inline as `[Ravi Gupta](people/ravi-gupta)`. Those
are upstream's own paths and are served unchanged: stripping them would modify the corpus
and would disadvantage any system whose extraction is built to read them.

[upstream]: https://github.com/garrytan/gbrain-evals
