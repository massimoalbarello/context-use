# Vendored evaluation corpus

`amara-life-v1/` is copied **verbatim** from [`garrytan/gbrain-evals`][upstream] and is
never edited. Everything Context Use adds about the corpus — expected entities, scoring,
Markdown rendering — lives outside this directory and is keyed by the corpus's own item
slugs.

| | |
| --- | --- |
| Upstream | `garrytan/gbrain-evals` |
| Commit | `565b80754ffa6abb9afb041026f2fab048aa7553` |
| Committed | 2026-06-03 |
| Path | `eval/data/amara-life-v1` |
| License | MIT (see the upstream repository) |

## Refreshing it

```sh
bun run eval corpus:refresh   # re-extracts the pinned commit and reports any difference
bun run eval corpus:verify    # hashes the working copy against the upstream manifest
```

`corpus:refresh` never rewrites the working copy. It reports a difference so that
re-pinning is a deliberate commit with a visible diff, because changing the corpus
invalidates every score measured against the previous one.

## Integrity

`corpus-manifest.json` ships upstream `content_sha256` values for all 418 items. Notes
and meetings are one file per item, so their hashes are reproduced directly and are
checked on every load by `loadCorpus` and by `corpus.test.ts`. Emails, Slack messages and
calendar events are many items inside one file (`inbox/emails.jsonl`,
`slack/messages.jsonl`, `calendar.ics`); upstream hashes those per item under a scheme
that is not documented and could not be reproduced, so those three files are covered
file-by-file by `corpus.lock.json` instead.

Between them, every byte in this directory is covered: the manifest proves the vendored
notes and meetings are upstream's, and the lockfile proves nothing has changed since
vendoring.

## Shape

418 items over 47 days.

| Type | Items | Span |
| --- | --- | --- |
| Slack | 300 | 13–17 April 2026 |
| Email | 50 | 13–20 April 2026 |
| Note | 40 | 25 January – 13 April 2026, every second day |
| Calendar event | 20 | 14–18 April 2026 |
| Meeting | 8 | 13–19 April 2026 |

Thirty-nine days hold a single note each. The remaining eight days, 13–20 April, hold 379
of the 418 items, which is why they are selectable as the `dense` window.

The corpus writes entity references inline as `[Ravi Gupta](people/ravi-gupta)`. Those
are upstream's own paths and are served unchanged: stripping them would modify the corpus
and would disadvantage any system whose extraction is built to read them.

[upstream]: https://github.com/garrytan/gbrain-evals
