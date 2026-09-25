import { afterEach, expect, test } from 'bun:test';
import {
  OPENCLAW_PACKAGE,
  OPENCLAW_REMOVAL_PROMPT,
} from '@context-use/openclaw-memory/setup-prompt';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginsSettings } from '../../src/routes/app.settings.plugins';

afterEach(cleanup);

test('copies setup for this instance and exposes script-owned removal', async () => {
  const user = userEvent.setup();
  const serverUrl = 'https://personal.context-use.com/mcp';
  render(<PluginsSettings serverUrl={serverUrl} />);
  expect(
    screen.getByRole('link', { name: 'memory plugin (opens in a new tab)' }).getAttribute('href'),
  ).toBe('https://www.npmjs.com/package/@context-use/openclaw-memory');
  const selfInstallation = screen.getByText('OpenClaw self-installation', { selector: 'summary' });
  expect(selfInstallation.closest('details')?.open).toBe(false);
  await user.click(selfInstallation);
  expect(selfInstallation.closest('details')?.open).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  const prompt = await navigator.clipboard.readText();
  expect(prompt).toContain('npx --yes @context-use/openclaw-memory@beta');
  expect(prompt).toContain(`${OPENCLAW_PACKAGE} connect '${serverUrl}'`);
  expect(prompt).toContain('Check openclaw --version first');
  expect(prompt).toContain('ask me to return the final localhost redirect URL');
  expect(prompt).toContain('verify openclaw context-use status');
  expect(prompt).toContain('If connected and authenticated, confirm that setup is complete');
  expect(prompt).toContain('start a new session with /new so the memory tools become available');
  expect(prompt).not.toContain('context_use_search_hypermedia');
  expect(prompt).toContain('Keep my conversations separate');
  expect(screen.getByRole('button', { name: 'Setup prompt copied' })).toBeTruthy();
  await user.click(selfInstallation);
  expect(selfInstallation.closest('details')?.open).toBe(false);

  await user.click(screen.getByText('Remove the plugin', { selector: 'summary' }));
  await user.click(screen.getByRole('button', { name: 'Copy removal prompt' }));
  expect(await navigator.clipboard.readText()).toBe(OPENCLAW_REMOVAL_PROMPT);
  expect(OPENCLAW_REMOVAL_PROMPT).toContain(`npx --yes ${OPENCLAW_PACKAGE} remove`);
});

test('clipboard failure keeps the exact setup prompt available for manual copying', async () => {
  const user = userEvent.setup();
  const original = navigator.clipboard.writeText;
  navigator.clipboard.writeText = () => Promise.reject(new Error('Clipboard unavailable'));
  try {
    render(<PluginsSettings serverUrl="https://personal.context-use.com/mcp" />);
    await user.click(screen.getByText('OpenClaw self-installation', { selector: 'summary' }));
    await user.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
    expect(screen.getByRole('alert').textContent).toContain('copy it manually');
    expect(
      (screen.getByRole('textbox', { name: 'OpenClaw setup prompt' }) as HTMLTextAreaElement).value,
    ).toContain(OPENCLAW_PACKAGE);
  } finally {
    navigator.clipboard.writeText = original;
  }
});
