import { Button } from '@repo/ui/button';
import { Check, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import { Field, FieldError, FieldLabel } from './ui/field';
import { Input } from './ui/input';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyableValue({ label, value }: { label: string; value: string }) {
  const inputId = useId();
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          className="font-mono"
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={copyValue}
        >
          {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      {copyState === 'failed' && (
        <FieldError>
          Could not access the clipboard. Select the value and copy it manually.
        </FieldError>
      )}
      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? `${label} copied.` : ''}
      </span>
    </Field>
  );
}
