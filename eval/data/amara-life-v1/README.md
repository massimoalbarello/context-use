# amara-life-v1

Raw personal activity used to evaluate extraction, distillation, and retrieval together.

- `corpus/` is the byte-for-byte upstream fixture: 418 email, Slack, calendar, meeting,
  and note items.
- `corpus.lock.json` pins every upstream file.
- `corpus.ts` adapts the upstream formats to the shared corpus contract.
- `qa/` owns the 99 authored questions, sealed answers, and evidence validation.
- `gold/` owns the structural entity/meeting expectations and offline scorer.

The reusable reader, distillation harness, and QA scorer are under
[`../../runner/`](../../runner/). Upstream provenance and refresh rules are in
[`../UPSTREAM.md`](../UPSTREAM.md).

```sh
bun run eval corpus:verify --corpus amara-life-v1
bun run eval qa:verify
bun run eval distill --corpus amara-life-v1 --window dense
bun run eval qa:ask
bun run eval qa:score
```
