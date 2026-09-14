import { Button, buttonVariants } from '@repo/ui/button';
import { Check, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import claudeLogoUrl from '../../assets/claude.svg';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import INITIAL_CONTEXT_PROMPT from './initial-context-prompt.md?raw';

type CopyState = 'idle' | 'copied' | 'failed';
const MCP_SERVER_NAME = 'Context Use';

export function agentConnectionHelpPrompt(mcpServerUrl: string): string {
  return `Guide me in setting up the Context Use MCP connector in this agent. Give me concise, numbered steps to add ${mcpServerUrl} as a custom Streamable HTTP MCP server named “Context Use”, connect it, and approve the OAuth request in my browser. Finish by helping me confirm that the Context Use tools are available.`;
}

export function initialContextPrompt(): string {
  return INITIAL_CONTEXT_PROMPT.trim();
}

function CopyableConnectionValue({
  copyLabel,
  label,
  value,
}: {
  copyLabel: string;
  label: string;
  value: string;
}) {
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
    <div className="grid gap-2">
      <Label htmlFor={inputId} className="text-muted-foreground text-xs">
        {label}
      </Label>
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
          aria-label={copyLabel}
          onClick={copyValue}
        >
          {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      {copyState === 'failed' && (
        <p className="text-destructive text-sm" role="alert">
          Could not access the clipboard. Select the value and copy it manually.
        </p>
      )}
      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? `${label} copied.` : ''}
      </span>
    </div>
  );
}

function McpServerDetails({ serverUrl }: { serverUrl: string }) {
  return (
    <Card>
      <CardContent className="grid gap-4">
        <CopyableConnectionValue
          copyLabel="Copy server name"
          label="Server name"
          value={MCP_SERVER_NAME}
        />
        <CopyableConnectionValue copyLabel="Copy server URL" label="Server URL" value={serverUrl} />
      </CardContent>
    </Card>
  );
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
  const claudeConnectionUrl = new URL('https://claude.ai/customize/connectors');
  claudeConnectionUrl.search = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: MCP_SERVER_NAME,
    connectorUrl: mcpServerUrl,
  }).toString();

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
          <h2 id="connect-mcp-heading" className="font-semibold text-xl">
            Connect your agent to Context Use MCP server
          </h2>

          <div className="grid gap-2">
            <a
              className={buttonVariants({
                variant: 'outline',
                size: 'lg',
                className: 'justify-self-start',
              })}
              href={claudeConnectionUrl.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src={claudeLogoUrl} alt="" className="size-5" width={20} height={20} />
              Connect to Claude
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Opens Claude with the server name and URL filled in. Add the connector, then connect
              and approve access to Context Use.
            </p>
          </div>

          <div className="grid gap-3">
            <p className="text-muted-foreground text-sm leading-relaxed">
              To connect manually in Claude or another agent, add a custom MCP connector using these
              details.
            </p>
            <McpServerDetails serverUrl={mcpServerUrl} />
          </div>

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
              Once connected, paste this prompt into your agent. It will import the memories and
              user context already available to your agent into this empty Context Use instance.
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
            Refresh this page when the import is complete.
          </p>
        </section>
      </li>
    </ol>
  );
}
