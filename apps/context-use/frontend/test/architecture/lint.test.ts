import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { ESLint } from 'eslint';

const WORKSPACE = resolve(import.meta.dir, '../../../../..');
const SOURCE = 'apps/context-use/frontend/src';
const LINT_TIMEOUT_MS = 30_000;

async function lint({
  source,
  file = 'components/lint-fixture.tsx',
}: {
  source: string;
  file?: string;
}) {
  // The Tailwind compiler worker needs Node's worker_threads API, not Bun's.
  const lintProcess = Bun.spawn({
    cmd: [
      'node',
      'node_modules/eslint/bin/eslint.js',
      '--stdin',
      '--stdin-filename',
      `${SOURCE}/${file}`,
      '--format',
      'json',
    ],
    cwd: WORKSPACE,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  lintProcess.stdin.write(source);
  lintProcess.stdin.end();
  const [exitCode, output, errors] = await Promise.all([
    lintProcess.exited,
    new Response(lintProcess.stdout).text(),
    new Response(lintProcess.stderr).text(),
  ]);
  expect(errors).toBe('');
  expect([0, 1]).toContain(exitCode);
  const [result] = JSON.parse(output) as ESLint.LintResult[];
  expect(result?.fatalErrorCount).toBe(0);
  return result!.messages;
}

test(
  'the app theme and dynamic geometry remain valid',
  async () => {
    expect(
      await lint({
        source: `
    export const Overlay = ({ x }: { x: number }) => (
      <div className="bg-background text-foreground dark:bg-card max-h-[32rem]"
        style={{ left: x, width: '25%' }}>
        <svg className="fill-none stroke-chart-1" />
      </div>
    );
  `,
      }),
    ).toEqual([]);
  },
  LINT_TIMEOUT_MS,
);

test.each([
  { className: 'hover:bg-red-500', rule: 'shadcn/no-raw-colors' },
  { className: 'bg-madeuptoken', rule: 'shadcn/no-raw-colors' },
  { className: 'flex-cols', rule: 'shadcn/no-unknown-classes' },
  // Requires the real Tailwind theme compiler; the grammar fallback accepts this.
  { className: 'hovr:flex', rule: 'shadcn/no-unknown-classes' },
])(
  'rejects $className with actionable lint feedback',
  async ({ className, rule }) => {
    const messages = await lint({
      source: `export const View = () => <div className="${className}" />;`,
    });
    expect(messages).toEqual([expect.objectContaining({ ruleId: rule, severity: 2 })]);
  },
  LINT_TIMEOUT_MS,
);

test(
  'shared Button aliases advise against restyling without blocking layout',
  async () => {
    const messages = await lint({
      source: `
    import { Button as Action } from '@repo/ui/button';
    export const View = () => <>
      <Action variant="outline" size="sm" shape="round" className="mt-4 w-full px-4" />
      <Action className="bg-primary rounded-full" />
    </>;
  `,
    });
    expect(messages).toHaveLength(2);
    expect(
      messages.every(({ ruleId, severity }) => ruleId === 'shadcn/no-restyle' && severity === 1),
    ).toBe(true);
  },
  LINT_TIMEOUT_MS,
);

test(
  'UI primitives may style their internals but still reject palette colors',
  async () => {
    const messages = await lint({
      file: 'components/ui/lint-fixture.tsx',
      source: `
    import { Button } from '@repo/ui/button';
    export const Control = () => <Button className="bg-primary rounded-full hover:bg-red-500" />;
  `,
    });
    expect(messages).toEqual([
      expect.objectContaining({ ruleId: 'shadcn/no-raw-colors', severity: 2 }),
    ]);
  },
  LINT_TIMEOUT_MS,
);

test(
  'query inputs must appear in their cache key',
  async () => {
    const source = `
    import { queryOptions } from '@tanstack/react-query';
    const load = async (id: string) => id;
    export const options = (id: string) => queryOptions({
      queryKey: ['resource'], queryFn: () => load(id),
    });
  `;
    expect(await lint({ source })).toEqual([
      expect.objectContaining({ ruleId: '@tanstack/query/exhaustive-deps', severity: 2 }),
    ]);
    expect(await lint({ source: source.replace("['resource']", "['resource', id]") })).toEqual([]);
  },
  LINT_TIMEOUT_MS,
);

test(
  'query clients cannot be recreated on every render',
  async () => {
    const source = `
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { useState } from 'react';
    export function View() {
      const client = new QueryClient();
      return <QueryClientProvider client={client}><div /></QueryClientProvider>;
    }
  `;
    expect(await lint({ source })).toEqual([
      expect.objectContaining({ ruleId: '@tanstack/query/stable-query-client', severity: 2 }),
    ]);
    expect(
      await lint({
        source: source.replace(
          'const client = new QueryClient()',
          'const [client] = useState(() => new QueryClient())',
        ),
      }),
    ).toEqual([]);
  },
  LINT_TIMEOUT_MS,
);
