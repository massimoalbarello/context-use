import { expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { AgentSetup } from '../../src/components/setup/agent-setup';

test('Claude quick connect preserves the instance URL and leaves manual setup available', async () => {
  const mcpServerUrl = 'https://personal-context.nibrun.app/nested/mcp?workspace=a%20b&mode=read';
  try {
    render(createElement(AgentSetup, { mcpServerUrl }));

    const link = screen.getByRole('link', { name: 'Connect Claude (opens in a new tab)' });
    const destination = new URL(link.getAttribute('href') ?? '');
    expect(destination.origin + destination.pathname).toBe(
      'https://claude.ai/customize/connectors',
    );
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      modal: 'add-custom-connector',
      connectorName: 'Context Use',
      connectorUrl: mcpServerUrl,
    });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const user = userEvent.setup();
    const manualSetup = screen.getByRole('button', { name: 'Connect other agents' });
    expect(manualSetup.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Server URL' })).toBeNull();
    await user.click(manualSetup);
    expect(manualSetup.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Server URL' }).getAttribute('value')).toBe(
      mcpServerUrl,
    );
    expect(
      screen.getByRole('textbox', { name: 'MCP setup help prompt', hidden: true }).textContent,
    ).toContain(mcpServerUrl);
    await user.click(manualSetup);
    expect(manualSetup.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Server URL' })).toBeNull();
  } finally {
    cleanup();
  }
});
