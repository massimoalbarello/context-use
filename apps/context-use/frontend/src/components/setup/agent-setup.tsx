import { Button, buttonVariants } from '@repo/ui/button';
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import claudeLogoUrl from '../../assets/claude.svg';
import { CopyablePrompt } from '../copyable-prompt';
import { CopyableValue } from '../copyable-value';
import { Card, CardContent } from '../ui/card';
import INITIAL_CONTEXT_PROMPT from './initial-context-prompt.md?raw';

const MCP_SERVER_NAME = 'Context Use';

export function agentConnectionHelpPrompt(mcpServerUrl: string): string {
  return `Guide me in setting up the Context Use MCP connector in this agent. Give me concise, numbered steps to add ${mcpServerUrl} as a custom Streamable HTTP MCP server named “Context Use”, connect it, and approve the OAuth request in my browser. Finish by helping me confirm that the Context Use tools are available.`;
}

export function initialContextPrompt(): string {
  return INITIAL_CONTEXT_PROMPT.trim();
}

function McpServerDetails({ serverUrl }: { serverUrl: string }) {
  return (
    <Card>
      <CardContent className="grid gap-4">
        <CopyableValue label="Server name" value={MCP_SERVER_NAME} />
        <CopyableValue label="Server URL" value={serverUrl} />
      </CardContent>
    </Card>
  );
}

export function AgentSetup({ mcpServerUrl }: { mcpServerUrl: string }) {
  const [manualSetupOpen, setManualSetupOpen] = useState(false);
  const manualSetupId = useId();
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

          <div className="flex flex-wrap items-center gap-2">
            <a
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
              href={claudeConnectionUrl.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img src={claudeLogoUrl} alt="" className="size-5" width={20} height={20} />
              Connect Claude
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">or</span>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                aria-expanded={manualSetupOpen}
                aria-controls={manualSetupId}
                onClick={() => setManualSetupOpen(!manualSetupOpen)}
              >
                Connect other agents
                <ChevronDown aria-hidden="true" className={manualSetupOpen ? 'rotate-180' : ''} />
              </Button>
            </div>
          </div>

          <div id={manualSetupId} hidden={!manualSetupOpen}>
            {manualSetupOpen && (
              <div className="grid gap-4">
                <McpServerDetails serverUrl={mcpServerUrl} />
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Paste this prompt into your agent for setup instructions.
                </p>
                <CopyablePrompt
                  ariaLabel="MCP setup help prompt"
                  copyLabel="Copy setup help"
                  copiedLabel="Setup help copied"
                  rows={5}
                  value={connectionHelpPrompt}
                />
              </div>
            )}
          </div>
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
            buttonVariant="default"
            buttonSize="lg"
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
