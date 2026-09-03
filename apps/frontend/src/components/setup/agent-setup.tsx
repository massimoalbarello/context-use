import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { McpServerUrl } from '../mcp/mcp-server-url';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Textarea } from '../ui/textarea';
import INITIAL_CONTEXT_PROMPT from './initial-context-prompt.md?raw';

type CopyState = 'idle' | 'copied' | 'failed';

export function agentConnectionHelpPrompt(mcpServerUrl: string): string {
  return `Guide me in setting up the Context Use MCP connector in this agent. Give me concise, numbered steps to add ${mcpServerUrl} as a custom Streamable HTTP MCP server named “Context Use”, connect it, and approve the OAuth request in my browser. Finish by helping me confirm that the Context Use tools are available.`;
}

export function initialContextPrompt(): string {
  return INITIAL_CONTEXT_PROMPT.trim();
}

function CopyablePrompt({
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

export function AgentSetup({ mcpServerUrl }: { mcpServerUrl: string }) {
  const connectionHelpPrompt = agentConnectionHelpPrompt(mcpServerUrl);
  const contextPrompt = initialContextPrompt();

  return (
    <ol className="grid list-none gap-10 p-0">
      <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm"
        >
          1
        </span>
        <section className="grid min-w-0 gap-4" aria-labelledby="connect-mcp-heading">
          <div className="grid gap-1">
            <h2 id="connect-mcp-heading" className="font-semibold text-xl">
              Connect to the MCP server
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Open your agent’s MCP or connector settings. Add a custom server, choose Streamable
              HTTP, name it “Context Use”, and paste this URL. Then start the connection and approve
              the Context Use OAuth request in your browser. Continue when Context Use tools appear
              in your agent.
            </p>
          </div>

          <McpServerUrl serverUrl={mcpServerUrl} />

          <details>
            <summary className="cursor-pointer font-medium text-sm">
              Not sure where those settings are?
            </summary>
            <div className="grid gap-2 pt-3">
              <p className="text-muted-foreground text-sm leading-relaxed">
                Paste this short prompt into your agent for setup instructions.
              </p>
              <CopyablePrompt
                ariaLabel="MCP setup help prompt"
                copyLabel="Copy setup help"
                copiedLabel="Setup help copied"
                rows={5}
                value={connectionHelpPrompt}
              />
            </div>
          </details>
        </section>
      </li>

      <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm"
        >
          2
        </span>
        <section className="grid min-w-0 gap-4" aria-labelledby="import-memories-heading">
          <div className="grid gap-1">
            <h2 id="import-memories-heading" className="font-semibold text-xl">
              Import memories from your favorite agent
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Once connected, paste this prompt into your agent. It will start with memories the
              agent has created about you, using previous conversations as useful supporting context
              when needed.
            </p>
          </div>

          <CopyablePrompt
            ariaLabel="Initial context prompt"
            copyLabel="Copy context prompt"
            copiedLabel="Context prompt copied"
            rows={18}
            value={contextPrompt}
          />
        </section>
      </li>

      <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm"
        >
          3
        </span>
        <section className="grid gap-1" aria-labelledby="refresh-page-heading">
          <h2 id="refresh-page-heading" className="font-semibold text-xl">
            Refresh the page
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Refresh this page when the import is complete. We’ll also check every 15 seconds and
            open your hypermedia automatically.
          </p>
        </section>
      </li>
    </ol>
  );
}
