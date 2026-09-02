import { Check, Copy, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { McpServerUrl } from '../mcp/mcp-server-url';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Textarea } from '../ui/textarea';

type CopyState = 'idle' | 'copied' | 'failed';

export function agentConnectionHelpPrompt(mcpServerUrl: string): string {
  return `Help me add a custom MCP server to the agent app I am using now. Identify the app from the current environment if you can; otherwise ask me which app it is. Then give me concise, numbered, app-specific steps to open its MCP or connector settings, add ${mcpServerUrl} as a Streamable HTTP server, start the connection, and approve the OAuth request in my browser. This is a settings-level action I must perform. Do not try to register or connect the server yourself, and do not ask me for access tokens or credentials. Stop after helping me confirm that the Context Use tools are available.`;
}

export function initialContextPrompt(applicationUrl: string): string {
  return `Bootstrap an evidence-grounded Context Use profile of me. Context Use is already connected. Work in this order, and do not write to Context Use until steps 1–3 are complete.

1. Understand me before modeling me
First determine whether the available context reliably identifies me as the person who owns this Context Use instance. If you cannot reliably identify me, stop and tell me that you cannot safely bootstrap my context from what is available. Do not write anything to Context Use, and do not substitute information about another person, a workspace, a project, or a generic user profile.

If you can reliably identify me, review the context about me that is already legitimately available to you: our conversation history, saved memory, the current workspace, and services I have authorized you to access. Explore those sources deliberately enough to understand my identity and roles, current priorities and projects, important relationships, working style and preferences, constraints, and durable experiences or ideas that shape my decisions. Focus on me: information about a topic matters only when it reveals my relationship to it. Do not perform broad external research.

2. Separate signal from noise
Build a private working synthesis of candidate facts and themes. For each candidate, consider its evidence, confidence, durability, sensitivity, and whether it would materially help a future agent understand me or make better decisions for me. Keep specific, well-supported context with lasting relevance. Reject generic facts, unrelated document contents, fleeting tasks or statuses, stale or duplicated details, secrets and credentials, sensitive claims I did not provide, and unsupported inference. Distinguish direct evidence from interpretation and preserve uncertainty. Do not upload this scratch work.

3. Pass a quality gate and plan the structure
Before writing, ask: “Does this feel recognizably about this person, and will it change how a future agent helps them?” If the evidence is thin, ambiguous, or contradictory, ask me up to three focused questions and wait for my answers instead of filling gaps with guesses. Then call read_hypermedia_curation_guide and follow it. Decide how to represent the synthesis only after you understand it. Entities should be stable, specifically identifiable people, organizations, projects, places, works, objects, or ideas that are central to my story—not keywords. Knowledge pages should be cohesive, specific accounts of meaningful facets of me, with relationships explained in prose—not a catch-all biography or fact dump.

4. Create a small, high-signal foundation
As the first write, call create_entity with isSelf set to true to create my owner entity. If an owner entity already exists, inspect it and do not create another. Create at most five additional entities and at most three knowledge pages, and create fewer when the evidence does not justify them. Include an entity only when it helps express a meaningful relationship. Write nuanced, readable pages that synthesize evidence rather than listing observations. Use temporal or uncertainty qualifiers where needed, and use the canonical Context Use addresses returned by the tools for mentions and references. Do not upload assets during this first pass.

5. Verify and hand back
Reread the resulting entities and pages. Confirm that every item is supported, personally relevant, non-duplicative, and useful; fix any clear mistakes before finishing. Then tell me the upload is complete, direct me to ${applicationUrl}/entities, briefly explain what you chose to represent and why, and mention any important uncertainty or omission. After I have reviewed it, ask whether I want a deeper research and import pass. Do not begin that deeper pass without my approval.`;
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

export function AgentSetup({
  applicationUrl,
  mcpServerUrl,
}: {
  applicationUrl: string;
  mcpServerUrl: string;
}) {
  const connectionHelpPrompt = agentConnectionHelpPrompt(mcpServerUrl);
  const contextPrompt = initialContextPrompt(applicationUrl);

  return (
    <ol className="grid list-none gap-10 p-0">
      <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm"
        >
          1
        </span>
        <section className="grid min-w-0 gap-4" aria-labelledby="add-mcp-heading">
          <div className="grid gap-1">
            <h2 id="add-mcp-heading" className="font-semibold text-xl">
              Add the MCP server
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Open your agent’s MCP or connector settings. Add a custom server, choose Streamable
              HTTP, and paste this URL.
            </p>
          </div>

          <McpServerUrl serverUrl={mcpServerUrl} />

          <details>
            <summary className="cursor-pointer font-medium text-sm">
              Not sure where those settings are?
            </summary>
            <div className="grid gap-2 pt-3">
              <p className="text-muted-foreground text-sm leading-relaxed">
                Paste this short prompt into the agent you want to connect. It will guide you
                through that agent’s setup without trying to perform the settings change itself.
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
        <section className="grid gap-1" aria-labelledby="authorize-heading">
          <h2 id="authorize-heading" className="font-semibold text-xl">
            Connect and authorize
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Start the connection in your agent, then approve the Context Use OAuth request in your
            browser. Continue when Context Use tools appear in the agent’s tool list.
          </p>
        </section>
      </li>

      <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm"
        >
          3
        </span>
        <section className="grid min-w-0 gap-4" aria-labelledby="bootstrap-context-heading">
          <div className="grid gap-1">
            <h2 id="bootstrap-context-heading" className="font-semibold text-xl">
              Bootstrap your context
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Once connected, paste this prompt into the agent. It will gather the available
              evidence about you, separate signal from noise, and start curating your context.
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
          4
        </span>
        <section
          className="grid justify-items-start gap-3"
          aria-labelledby="review-context-heading"
        >
          <div className="grid gap-1">
            <h2 id="review-context-heading" className="font-semibold text-xl">
              Reload and review
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Once your agent says the upload is complete, reload this page. Context Use will take
              you to Entities to review what it created.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => window.location.reload()}
          >
            <RotateCw aria-hidden="true" />
            Reload Context Use
          </Button>
        </section>
      </li>
    </ol>
  );
}
