# world-v1

Already-distilled biographical pages used to evaluate retrieval independently of the
activity distiller.

- `corpus/` is the byte-for-byte upstream fixture: 240 page shards plus two non-content
  files.
- `corpus.lock.json` pins every upstream file.
- `corpus.ts` strips `_facts` and adapts the public prose to the shared corpus contract.
- `qa/` owns the 145 derived questions, sealed answers, derivation, and seeding code.

The reusable reader and QA scorer are under [`../../runner/`](../../runner/). Upstream
provenance and refresh rules are in [`../UPSTREAM.md`](../UPSTREAM.md).

```sh
bun run eval corpus:verify --corpus world-v1
bun run eval qa:derive
bun run eval qa:seed
bun run eval qa:ask
bun run eval qa:score
```
