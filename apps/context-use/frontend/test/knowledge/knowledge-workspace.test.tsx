import { afterEach, expect, spyOn, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KnowledgeWorkspace,
  KnowledgeWorkspaceProvider,
  useKnowledgeWorkspace,
} from '../../src/components/knowledge/knowledge-workspace';

afterEach(cleanup);

function Sidebar() {
  const { collapsed, toggleSidebar } = useKnowledgeWorkspace();
  return (
    <button type="button" aria-expanded={!collapsed} onClick={toggleSidebar}>
      {collapsed ? 'Open sidebar' : 'Collapse sidebar'}
    </button>
  );
}

function Workspace({ route = 'hypermedia' }: { route?: string }) {
  return (
    <KnowledgeWorkspaceProvider>
      <KnowledgeWorkspace key={route}>
        <Sidebar />
      </KnowledgeWorkspace>
    </KnowledgeWorkspaceProvider>
  );
}

test('sidebar starts closed and restores both preferences after workspace and app remounts', async () => {
  const user = userEvent.setup();
  const view = render(<Workspace />);
  expect(screen.getByRole('button', { name: 'Open sidebar' }).getAttribute('aria-expanded')).toBe(
    'false',
  );
  await user.click(screen.getByRole('button', { name: 'Open sidebar' }));

  view.rerender(<Workspace route="resources" />);
  expect(
    screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded'),
  ).toBe('true');
  view.unmount();

  const refreshed = render(<Workspace route="resources" />);
  await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  refreshed.rerender(<Workspace />);
  expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
  refreshed.unmount();

  render(<Workspace />);
  expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
});

test('unavailable storage keeps sidebar toggles and navigation usable', async () => {
  const getItem = spyOn(window.localStorage, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  const setItem = spyOn(window.localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  try {
    const user = userEvent.setup();
    const view = render(<Workspace />);
    await user.click(screen.getByRole('button', { name: 'Open sidebar' }));
    view.rerender(<Workspace route="resources" />);
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    view.rerender(<Workspace />);
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
  } finally {
    getItem.mockRestore();
    setItem.mockRestore();
  }
});
