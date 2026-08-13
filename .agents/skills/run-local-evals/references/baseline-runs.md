# Recorded local eval baselines

These records are durable comparison notes, not pass/fail thresholds. Generated reports remain the detailed source of truth and are gitignored.

## PR 294 Steve Jobs suite — 13 August 2026

- Pull request: `massimoalbarello/context-use#294`, “fix: improve proactive knowledge writes and eval scoring”
- Revision: `f150846dd9fa6712c98aecf271170bea0c13f2f3`
- Provider: Codex
- Command: `bun run eval story:run --all`
- Run ID: `steve-jobs-v1-suite-2026-08-13T19-21-29-852Z-codex`
- Generated report: `eval/results/stories/steve-jobs-v1-suite-2026-08-13T19-21-29-852Z-codex/report.md`
- Overall score: **58.9%**
- Historical-story average excluding the implicit-write trigger: **68.7%**

Per-story scores:

| Story | Score |
| --- | ---: |
| `implicit-write-trigger` | 0.0% |
| `microsoft-partnership` | 70.4% |
| `imac-design-and-launch` | 63.4% |
| `ipod-review-and-launch` | 67.8% |
| `itunes-label-partnerships` | 56.6% |
| `rokr-partnership` | 66.4% |
| `iphone-carrier-and-launch` | 87.7% |

The implicit prompt did not activate Context Use or produce a knowledge mutation. In the historical stories, hygiene and occurrence handling were generally strong, but ambiguous Apple identity resolution caused placement, timeline, and reconciliation misses, and reciprocal relationship coverage was weak, especially for iTunes. The iPhone story was strongest and correctly reconciled Cingular to AT&T without creating a duplicate.

This was one stochastic run. Preserve its harness and provider details when using it as a comparison baseline.
