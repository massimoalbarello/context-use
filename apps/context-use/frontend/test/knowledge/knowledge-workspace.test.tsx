import { afterEach, expect, test } from 'bun:test';
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

for (const route of ['hypermedia', 'resources']) {
  test(`sidebar retains navigation state but resets after refreshing ${route}`, async () => {
    const user = userEvent.setup();
    const otherRoute = route === 'hypermedia' ? 'resources' : 'hypermedia';
    const view = render(<Workspace route={route} />);
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    view.rerender(<Workspace route={otherRoute} />);
    expect(screen.getByRole('button', { name: 'Open sidebar' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    view.rerender(<Workspace route={route} />);
    await user.click(screen.getByRole('button', { name: 'Open sidebar' }));
    view.rerender(<Workspace route={otherRoute} />);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    view.rerender(<Workspace route={route} />);
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy();
    view.unmount();

    render(<Workspace route={route} />);
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });
}
