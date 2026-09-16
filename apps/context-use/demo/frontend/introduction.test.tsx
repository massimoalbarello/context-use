import { expect, spyOn, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoIntroduction } from './introduction';

test('welcome dismisses for the session and can be reopened with focus restored', async () => {
  const triggerContainer = document.createElement('div');
  document.body.append(triggerContainer);
  window.sessionStorage.clear();
  const user = userEvent.setup();
  try {
    const view = render(<DemoIntroduction triggerContainer={triggerContainer} />);
    expect(screen.getByRole('dialog', { name: 'All your context, in one place.' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const about = screen.getByRole('button', { name: 'About this demo' });
    await waitFor(() => expect(document.activeElement).toBe(about));

    view.unmount();
    render(<DemoIntroduction triggerContainer={triggerContainer} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'About this demo' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About this demo' })),
    );

    cleanup();
    window.sessionStorage.clear();
    render(<DemoIntroduction triggerContainer={triggerContainer} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  } finally {
    cleanup();
    triggerContainer.remove();
    window.sessionStorage.clear();
  }
});

test('blocked session storage does not prevent exploring or reopening the demo', async () => {
  const triggerContainer = document.createElement('div');
  document.body.append(triggerContainer);
  const read = spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  const write = spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  const user = userEvent.setup();
  try {
    render(<DemoIntroduction triggerContainer={triggerContainer} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'About this demo' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  } finally {
    cleanup();
    triggerContainer.remove();
    read.mockRestore();
    write.mockRestore();
  }
});
