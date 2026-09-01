import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';

type CopyState = 'idle' | 'copied' | 'failed';

export function McpServerUrl({ serverUrl }: { serverUrl: string }) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  async function copyServerUrl() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2">
          <Input
            className="font-mono"
            aria-label="MCP server URL"
            readOnly
            value={serverUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Copy MCP server URL"
            onClick={copyServerUrl}
          >
            {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
        </div>
        {copyState === 'failed' && (
          <p className="text-destructive text-sm" role="alert">
            Could not access the clipboard. Select the URL and copy it manually.
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {copyState === 'copied' ? 'MCP server URL copied.' : ''}
        </span>
      </CardContent>
    </Card>
  );
}
