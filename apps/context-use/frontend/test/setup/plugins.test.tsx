import { afterEach, expect, test } from 'bun:test';
import { OPENCLAW_PACKAGE } from '@context-use/openclaw-memory/setup-prompt';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginsSettings } from '../../src/routes/app.settings.plugins';

afterEach(cleanup);

test('copies the instance URL and skill bootstrap without a dashboard lifecycle guide', async () => {
  const user = userEvent.setup();
  const serverUrl = 'https://personal.context-use.com/mcp';
  render(<PluginsSettings serverUrl={serverUrl} />);
  expect(
    screen.getByRole('link', { name: 'memory plugin (opens in a new tab)' }).getAttribute('href'),
  ).toBe('https://www.npmjs.com/package/@context-use/openclaw-memory');
  await user.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  const prompt = await navigator.clipboard.readText();
  expect(prompt).toContain(`Install ${OPENCLAW_PACKAGE}`);
  expect(prompt).toContain(serverUrl);
  expect(prompt).toContain(`npx --yes ${OPENCLAW_PACKAGE} instructions`);
  expect(screen.getByRole('button', { name: 'Setup prompt copied' })).toBeTruthy();
  expect(screen.getByText(/reauthorize or remove the plugin/)).toBeTruthy();
});

test('clipboard failure keeps the exact setup prompt available for manual copying', async () => {
  const user = userEvent.setup();
  const original = navigator.clipboard.writeText;
  navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard unavailable'));
  try {
    render(<PluginsSettings serverUrl="https://personal.context-use.com/mcp" />);
    await user.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
    expect(screen.getByRole('alert').textContent).toContain('copy it manually');
    expect(
      (screen.getByRole('textbox', { name: 'OpenClaw setup prompt' }) as HTMLTextAreaElement).value,
    ).toContain(OPENCLAW_PACKAGE);
  } finally {
    navigator.clipboard.writeText = original;
  }
});
