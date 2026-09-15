import {
  OPENCLAW_NPM_URL,
  OPENCLAW_REMOVAL_PROMPT,
  openclawSetupPrompt,
} from '@context-use/openclaw-memory/setup-prompt';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CopyablePrompt } from '../components/copyable-prompt';
import { mcpClientsQueryOptions } from '../queries/mcp-clients';

export const Route = createFileRoute('/settings/plugins')({
  loader: ({ context }) => context.queryClient.ensureQueryData(mcpClientsQueryOptions),
  component: PluginsSettingsRoute,
});

function PluginsSettingsRoute() {
  const { data } = useSuspenseQuery(mcpClientsQueryOptions);
  return <PluginsSettings serverUrl={data.serverUrl} />;
}

export function PluginsSettings({ serverUrl }: { serverUrl: string }) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-2">
        <h1 className="font-semibold text-3xl tracking-tight">Plugins</h1>
        <p className="text-muted-foreground">Give your agent a memory that grows with you.</p>
      </header>

      <section className="grid min-w-0 gap-5" aria-labelledby="openclaw-plugin-heading">
        <div className="grid gap-2">
          <h2 id="openclaw-plugin-heading" className="font-semibold text-xl">
            OpenClaw
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Context Use provides a{' '}
            <a
              className="text-foreground underline underline-offset-4"
              href={OPENCLAW_NPM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              memory plugin
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{' '}
            for OpenClaw that lets it learn from your conversations and remember what matters to
            you.
          </p>
        </div>

        <details className="grid gap-3">
          <summary className="cursor-pointer text-sm">OpenClaw self-installation</summary>
          <div className="mt-3 grid gap-3">
            <p className="text-muted-foreground text-sm">
              Copy this prompt into OpenClaw. It will handle setup and give you a link to authorize.
            </p>
            <CopyablePrompt
              ariaLabel="OpenClaw setup prompt"
              copyLabel="Copy setup prompt"
              copiedLabel="Setup prompt copied"
              rows={7}
              value={openclawSetupPrompt(serverUrl)}
            />
          </div>
        </details>

        <details className="grid gap-3">
          <summary className="cursor-pointer text-sm">Remove the plugin</summary>
          <div className="mt-3 grid gap-3">
            <p className="text-muted-foreground text-sm">
              OpenClaw removes the plugin and restores its previous memory settings. Your memories
              in Context Use are preserved.
            </p>
            <CopyablePrompt
              ariaLabel="OpenClaw removal prompt"
              copyLabel="Copy removal prompt"
              copiedLabel="Removal prompt copied"
              rows={4}
              value={OPENCLAW_REMOVAL_PROMPT}
            />
          </div>
        </details>
      </section>
    </div>
  );
}
