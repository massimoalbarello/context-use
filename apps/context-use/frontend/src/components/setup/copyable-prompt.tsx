import { Button } from '@repo/ui/button';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Textarea } from '../ui/textarea';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyablePrompt({
  ariaLabel,
  copyLabel,
  copiedLabel,
  rows,
  value,
}: {
  ariaLabel: string;
  copyLabel: string;
  copiedLabel: string;
  rows: number;
  value: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <Card size="sm">
      <CardContent className="grid gap-3">
        <Textarea
          aria-label={ariaLabel}
          className="max-h-96 resize-none overflow-y-auto font-mono text-xs leading-relaxed"
          readOnly
          rows={rows}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />

        <Button
          type="button"
          variant={rows < 10 ? 'outline' : 'default'}
          size={rows < 10 ? 'default' : 'lg'}
          className="justify-self-start"
          onClick={copyPrompt}
        >
          {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyState === 'copied' ? copiedLabel : copyLabel}
        </Button>

        {copyState === 'failed' && (
          <p className="text-destructive text-sm" role="alert">
            Could not access the clipboard. Select the prompt and copy it manually.
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {copyState === 'copied' ? `${copiedLabel}.` : ''}
        </span>
      </CardContent>
    </Card>
  );
}
