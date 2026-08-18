# LoCoMo v1

This package adapts LoCoMo into an end-to-end Context Use QA evaluation:

```text
one conversation -> activity distillation -> iterative knowledge search -> answers -> three scorers
```

It exists to put a Context Use number next to A-mem's. A-mem's repository vendors the same
`locomo10.json` — byte-identical to the pin here, both `79fa87e9…698ff4` — and evaluates it
one conversation at a time against a memory system reset between conversations. That is the
same shape as [the LongMemEval package](../longmemeval-v1/README.md), with the row
inverted: a LongMemEval row is one history and one question, a LoCoMo row is one history and
roughly two hundred.

## The dataset

Ten conversations between two named speakers, 19–32 dated sessions each, 369–689 turns, and
1,986 questions in five categories:

| category | what it asks | n | how the official scorer treats it |
| --- | --- | --- | --- |
| 1 multi-hop | facts composed across sessions | 282 | both sides split on commas; each required sub-answer credited by its best-matching fragment |
| 2 temporal | when something happened | 321 | token F1; the question carries upstream's "answer with an approximate date" instruction |
| 3 open-domain | inference about a speaker | 96 | token F1 against the reference truncated at its first `;` |
| 4 single-hop | one fact in one session | 841 | token F1 |
| 5 adversarial | unanswerable | 446 | scored on declining, never against the reference |

Category 5 draws its reference from `adversarial_answer`; every other category from
`answer`. Two rows carry both fields, so the category decides which is used, matching
A-mem's `QA.final_answer`.

## The dataset is pinned, not vendored

LoCoMo is **CC BY-NC 4.0**, unlike LongMemEval's MIT dataset. At 2.8 MB it is small enough
to vendor and is deliberately not vendored: a NonCommercial corpus does not belong in this
repository's history. `manifest.ts` pins the repository, an immutable revision, the byte
length and the SHA-256, and the first command that needs the file downloads it to:

```text
.eval-data/locomo/<revision>/locomo10.json
```

That directory is ignored by git and Docker, and every use verifies the cached bytes.

```sh
bun run eval locomo:fetch
bun run eval locomo:verify
bun run eval locomo:list
```

The same NonCommercial term applies to what is done with results. That is a licensing
question rather than a harness one, and it is worth answering before any of these numbers
are published.

## Isolation and the reset boundary

**The knowledge base is reset once per conversation.** All of a conversation's sessions are
distilled into one knowledge base, then every one of its selected questions is asked against
that base, and the stack resets only when the runner moves to the next conversation — whose
history and questions are independent by benchmark definition. Resetting per question would
throw away the knowledge under test; never resetting would let conversation seven answer
from conversation three.

Before distillation the runner writes a `locomo-case.json` containing only speakers, session
dates and turns. The questions, reference answers, categories and `evidence` dialogue ids
are absent from that shape entirely, so there is no field for them to leak through — the
turns do not even carry their `dia_id`, because that is the key `evidence` is written in.

The QA agent is started only after every session has been served, in a fresh conversation
per question. Only read-only knowledge tools are valid; a source read, write, shell or web
action voids that question, and a void question counts as a failure in every headline.

**One exception, and it is upstream's design rather than a gap here.** A category 5 question
is a forced choice between the real answer and "Not mentioned in the conversation", so its
reference answer is shown to the agent by construction. Both LoCoMo and A-mem do this. It is
sound because the score credits only the refusal — naming the answer that was just handed to
you scores zero — but it does mean category 5 is the one place gold reaches the agent.

## What one source record is

**One session, not one turn.** A turn is A-mem's memory unit because its memory is a note
store; the unit here is what one source produces, and LoCoMo's own unit is the dated
session. Splitting a session into its 20–35 turns would serve the same date that many times
and turn a conversation into a stream of one-line sources.

Sessions are 1.5–7 KB rendered, so the shared 24 KB agent transport ceiling closes a batch
at roughly seven sessions and each conversation distills in four or five batches. A session
is never split across batches; the ceiling changes transport batching, not the history and
not the reset boundary.

Image turns carry their BLIP caption inline as `[Image: …]`, because some questions are
answerable only from a shared image. Upstream's own prompt path includes the caption
whenever a turn has one, and so does this; A-mem additionally requires an `img_url`, which
drops the 39 caption-only turns in the pinned file.

## Small runs first

A full run is about 2,030 agent sessions — 45 distillations and 1,986 questions — so there
is no implicit whole-suite run. Selectors come in two axes, because the two costs are
independent: which conversations to distill, and which of each one's questions to ask.

```sh
# One conversation, two questions of every category — the cheapest honest smoke test
bun run eval locomo:run --conversation conv-30 --stratify 2

# The first two conversations, every question
bun run eval locomo:run --limit 2

# The first twenty questions of every conversation
bun run eval locomo:run --all --questions 20

# All ten conversations and all 1,986 questions; explicit because this is expensive
bun run eval locomo:run --all
```

Exactly one of `--conversation`, `--limit` and `--all` is required. `--questions` and
`--stratify` are optional and mutually exclusive, and **neither narrows the history** —
the whole conversation is always distilled, because a LoCoMo question's difficulty is how
far apart its evidence sits. A short run is therefore a cheap sample of the same
measurement rather than a different one.

## Three scores, and why not one

```sh
bun run eval locomo:score                                  # deterministic, no key, no session
bun run eval locomo:score <run-id> --judge-provider codex  # adds the judge
OPENAI_API_KEY=... bun run eval locomo:score <run-id> --judge-provider openai
```

**Official LoCoMo F1** is the headline: a port of `task_eval/evaluation.py`'s
`eval_question_answering`, with its per-category rules and its stemmed, article-stripped
multiset token F1. This is the benchmark's own published metric.

**A-mem's metrics** are reported beside it because **A-mem's published table is not the
official F1**. Its `utils.py` computes an unstemmed token-*set* F1 with a naive tokenizer,
plus BLEU and ROUGE, and the paper's headline numbers are that F1 and BLEU-1. On a verbose
answer the two differ by a wide margin, so reporting one as the other would be wrong in a
way nobody could see from the number alone.

**The LLM judge** is optional, off by default, and is this repository's rubric — LoCoMo
defines no official judge. It returns a score from 0 to 1: binary for four categories, and
for multi-hop the fraction of the required facts the answer contains, because LoCoMo's own
scorer splits those answers on commas and credits each part. An earlier all-or-nothing
version scored zero for five facts out of six where the official metric gave 0.83, which
made the category read as twice as weak as it is — a stricter bar than the benchmark sets,
invented here rather than inherited. It is here because both deterministic metrics measure answer
*shape* as much as answer *content*: `"The charity race raised awareness for mental
health."` against a gold `"mental health"` scores 0.44 official F1 and would be judged
correct. Without it, a retrieval failure and a verbosity penalty look identical. Scoring
without `--judge-provider` needs no API key and no agent session at all.

Void questions stay in the denominator of all three, so an infrastructure failure cannot
flatter a headline. Each score also reports the same average over answered questions only.

### The ports are checked against the real Python, not asserted

`metrics.fixture.json` holds values generated by the actual upstream implementations —
NLTK's `PorterStemmer`, `rouge_score`, `nltk.translate.bleu_score`, and both scorers'
own code. It covers 2,401 stems, being every token in all 1,986 reference answers, and 420
scored cases built from real answers under four answer shapes. The TypeScript matches on
every one, BLEU included. Regenerate it with:

```sh
python3 eval/data/locomo-v1/metrics-fixture.py \
    --dataset .eval-data/locomo/<revision>/locomo10.json \
    > eval/data/locomo-v1/metrics.fixture.json
```

That needs `nltk` and `rouge-score`. A stemmer that differs from NLTK's by one word moves
every F1 that word appears in, silently, so this is the difference between a port and a
guess.

## Reading a run back

```sh
bun run eval locomo:view [run-id] [--out path.html]
```

Writes every question beside its answer, the reference it was scored against, both
deterministic scores, the judge verdict where one exists, and what the answer cost in
seconds and tool calls. Reference answers come from the pinned dataset rather than from the
run, since no run artifact carries them — which is also why the page is written locally and
not published: LoCoMo is CC BY-NC and the page contains its gold.

Adversarial rows show the expected behaviour as *decline*, with the unsupported claim below
it. That distinction is easy to lose: category 5's reference field holds the tempting wrong
answer, so printing it under "expected" makes every correct refusal look like a miss.

## Deliberate departures, all of them recorded

| | upstream | here | why |
| --- | --- | --- | --- |
| Category 5 option order | `random.random()` | fixed by a hash of the question id | two runs of the same benchmark were not reproducible; still evenly split and not guessable |
| "Current date" | implicit — the model is handed the dated transcript | the last session's date, stated in the prompt | an agent reading a distilled knowledge base has no transcript to infer "now" from, and the temporal category would be unanswerable by construction |
| Source record | one turn (A-mem) | one dated session | see above |
| BERTScore, METEOR, SBERT | computed | omitted | each needs a downloaded model; a hand-rolled stand-in would produce a number that looks like A-mem's and is not |
| Retrieval recall | scored against `evidence` dialogue ids | not scored | dialogue ids do not survive distillation, so there is nothing to score them against — the same call LongMemEval made |

## What a comparison to A-mem does and does not say

The inputs are identical and the reset boundary is the same, which is what makes the
comparison worth making. The systems are not doing the same thing: A-mem retrieves over
notes derived from raw turns and hands the retrieved context to the model that answers,
while Context Use distills the conversation into a knowledge base first and then searches
it. That difference is the measurement. The verbosity effect is not, which is why the judge
is there.

Run artifacts land under `eval/results/locomo/`, including the public source copy,
distillation snapshots, agent transcripts, per-conversation results, a `predictions.jsonl`,
and the run report. **No run artifact contains a reference answer** — scoring re-reads the
dataset — so a report can be read or shared without carrying the answer key with it.

The report is rewritten after **every** conversation rather than once at the end. A full run
is hours long and one distillation batch alone can take twenty minutes, so stopping early
has to be a supported outcome: `locomo:score` reads `report.json`, and a run interrupted
after two of ten conversations scores those two rather than nothing.

## Attribution

LoCoMo is published in [the official LoCoMo repository](https://github.com/snap-research/locomo)
under CC BY-NC 4.0. The A-mem scorer this package also ports is from
[A-mem](https://github.com/WujiangXu/A-mem), MIT licensed. Both revisions are pinned in
`manifest.ts`.
