import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Textarea } from '../ui/textarea';

type CopyState = 'idle' | 'copied' | 'failed';

export function agentSetupPrompt({
  applicationUrl,
  mcpServerUrl,
}: {
  applicationUrl: string;
  mcpServerUrl: string;
}): string {
  return `Connect to my Context Use MCP server at ${mcpServerUrl} using Streamable HTTP. When authorization is required, start the OAuth flow and wait for me to approve it in my browser. Do not ask me to copy access tokens or credentials.

If you cannot add or connect to this MCP server yourself, stop. Tell me to create my first entity manually at ${applicationUrl}/entities/new, then register ${mcpServerUrl} in this agent's MCP settings. Ask me to return and tell you to continue once it is connected.

Once connected, create a deliberately small but useful first picture of me in Context Use. Review only relevant context about me that is already available to you in our conversations, memory, current workspace, or services I have authorized. Do not perform broad external research, infer sensitive facts, upload secrets, or preserve transient information. If you cannot confidently identify and briefly describe me, ask me one concise question before writing anything.

First call create_entity with isSelf set to true to create my owner entity. Then select only the people, organizations, projects, ideas, or places most central to my current work and life. Create at most five additional entities and at most three knowledge pages. Prefer durable, well-supported context likely to help future agents. Mention entities and reference pages using the canonical Context Use addresses returned by the tools. Do not upload assets during this first pass.

When the starter context is ready, direct me to ${applicationUrl}/pages to see the result and briefly tell me what I will find there. After I have seen it, ask whether I want a deeper research and import pass. Do not begin that deeper pass without my approval.`;
}

export function AgentSetup({
  applicationUrl,
  mcpServerUrl,
}: {
  applicationUrl: string;
  mcpServerUrl: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const prompt = agentSetupPrompt({ applicationUrl, mcpServerUrl });

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4">
        <Textarea
          aria-label="Agent setup prompt"
          className="max-h-80 resize-none overflow-y-auto font-mono text-xs leading-relaxed"
          readOnly
          rows={14}
          value={prompt}
          onFocus={(event) => event.currentTarget.select()}
        />

        <Button type="button" size="lg" className="justify-self-center" onClick={copyPrompt}>
          {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copyState === 'copied' ? 'Prompt copied' : 'Copy prompt'}
        </Button>

        <p className="text-center text-muted-foreground text-sm leading-relaxed">
          Approve the OAuth request when it opens. When the agent finishes, follow its Context Use
          link or refresh this page.
        </p>

        {copyState === 'failed' && (
          <p className="text-destructive text-sm" role="alert">
            Could not access the clipboard. Select the prompt and copy it manually.
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {copyState === 'copied' ? 'Agent setup prompt copied.' : ''}
        </span>
      </CardContent>
    </Card>
  );
}
