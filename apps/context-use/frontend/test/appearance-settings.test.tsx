import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { Route } from '../src/routes/app.settings.appearance';

const AppearanceSettings = Route.options.component!;

afterEach(() => {
  cleanup();
  localStorage.removeItem('context-use-theme');
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.style.removeProperty('color-scheme');
});

function renderAppearance() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" storageKey="context-use-theme">
      <AppearanceSettings />
    </ThemeProvider>,
  );
}

test('theme choices default to system, remain selected, and persist across mounts', async () => {
  const user = userEvent.setup();
  const view = renderAppearance();
  expect(screen.getByRole('button', { name: 'System', pressed: true })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();
  expect(localStorage.getItem('context-use-theme')).toBe('dark');

  await user.click(screen.getByRole('button', { name: 'Dark' }));
  expect(screen.getByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();

  view.unmount();
  renderAppearance();
  expect(screen.getByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Light' }));
  expect(screen.getByRole('button', { name: 'Light', pressed: true })).toBeTruthy();
  expect(localStorage.getItem('context-use-theme')).toBe('light');

  await user.click(screen.getByRole('button', { name: 'System' }));
  expect(screen.getByRole('button', { name: 'System', pressed: true })).toBeTruthy();
  expect(localStorage.getItem('context-use-theme')).toBe('system');
});

test('the theme selector supports keyboard navigation and activation', async () => {
  const user = userEvent.setup();
  renderAppearance();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'System' }));
  await user.keyboard('{ArrowRight}{ArrowRight} ');
  expect(screen.getByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();
});
