import { cn } from '@repo/ui/class-names';
import type { KnowledgePageDiff } from '../../queries/pages';
import { TemporalCoverageLabel } from './temporal-coverage-label';

const MIN_LINE_NUMBER_DIGITS = 3;

function DiffHunk({ hunk }: { hunk: KnowledgePageDiff['hunks'][number] }) {
  const lineNumberDigits = Math.max(
    MIN_LINE_NUMBER_DIGITS,
    String(hunk.oldStart + hunk.oldLines).length,
    String(hunk.newStart + hunk.newLines).length,
  );
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  const rows = hunk.lines.map((line) => {
    const marker = line[0];
    const row = {
      key: `${oldLine}:${newLine}:${marker}`,
      before: marker === ' ' || marker === '-' ? oldLine++ : '',
      after: marker === ' ' || marker === '+' ? newLine++ : '',
      marker,
      text: line.slice(1),
    };
    return row;
  });
  return (
    <div>
      <p className="bg-muted px-3 py-1.5 font-mono text-muted-foreground text-xs">
        @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </p>
      <div className="py-1 font-mono text-xs leading-6">
        {rows.map((row) => (
          <div
            key={row.key}
            style={{ gridTemplateColumns: `repeat(2, ${lineNumberDigits}ch) 2ch minmax(0, 1fr)` }}
            className={cn(
              'grid gap-x-2 px-3',
              row.marker === '+' && 'bg-diff-added/10 text-diff-added',
              row.marker === '-' && 'bg-diff-removed/10 text-diff-removed',
              row.marker === '\\' && 'text-muted-foreground italic',
            )}
          >
            <span className="select-none text-right opacity-60" aria-hidden="true">
              {row.before}
            </span>
            <span className="select-none text-right opacity-60" aria-hidden="true">
              {row.after}
            </span>
            <span className="select-none text-center" aria-hidden="true">
              {row.marker}
            </span>
            <span className="whitespace-pre-wrap break-words">
              {row.marker === '+' && <span className="sr-only">Added: </span>}
              {row.marker === '-' && <span className="sr-only">Removed: </span>}
              {row.text || '\u00a0'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RevisionDiff({ diff }: { diff: KnowledgePageDiff }) {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          {diff.from === 0 ? 'Full content' : `Revision ${diff.from} → ${diff.to}`}
        </span>
        <span className="text-diff-added">+{diff.additions} added</span>
        <span className="text-diff-removed">−{diff.deletions} removed</span>
      </div>
      {diff.temporalCoverage && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Temporal coverage:</span>
          {diff.temporalCoverage.from ? (
            <TemporalCoverageLabel expression={diff.temporalCoverage.from} />
          ) : (
            <span>Not set</span>
          )}
          <span aria-hidden="true">→</span>
          <span className="sr-only">changed to</span>
          {diff.temporalCoverage.to ? (
            <TemporalCoverageLabel expression={diff.temporalCoverage.to} />
          ) : (
            <span>Not set</span>
          )}
        </div>
      )}
      {diff.hunks.length === 0 ? (
        <p className="text-muted-foreground text-sm">No content changes.</p>
      ) : (
        <section
          className="min-w-0 overflow-hidden rounded-lg border border-border bg-background"
          aria-label="Content changes"
        >
          {diff.hunks.map((hunk) => (
            <DiffHunk key={`${hunk.oldStart}:${hunk.newStart}`} hunk={hunk} />
          ))}
        </section>
      )}
    </div>
  );
}
