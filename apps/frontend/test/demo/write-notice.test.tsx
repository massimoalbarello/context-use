import { expect, test } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEMO_WRITE_DENIED_EVENT, DemoWriteNotice, demoFetch } from '../../demo/write-notice';

const FORBIDDEN = 403;

test('the notice requires OK and returns focus to the attempted action', async () => {
  const events = new EventTarget();
  const user = userEvent.setup();
  try {
    render(
      <>
        <button
          type="button"
          onClick={(event) =>
            events.dispatchEvent(
              new CustomEvent(DEMO_WRITE_DENIED_EVENT, { detail: event.currentTarget }),
            )
          }
        >
          Save
        </button>
        <DemoWriteNotice events={events} />
      </>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    expect(screen.getByRole('alertdialog').textContent).toContain('This is a read-only demo');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'OK' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(save));
  } finally {
    cleanup();
  }
});

test('demo write denials open a notice and remain failed without an inline message', async () => {
  let notices = 0;
  const request = demoFetch({
    fetch: async () =>
      Response.json({ code: 'DEMO_READ_ONLY', message: 'Read-only demo' }, { status: 403 }),
    onWriteDenied: () => {
      notices++;
    },
  });
  const response = await request('/api/entities', { method: 'POST' });
  expect(response.status).toBe(FORBIDDEN);
  expect(response.ok).toBe(false);
  expect(await response.json()).toEqual({ code: 'DEMO_READ_ONLY', message: '' });
  expect(notices).toBe(1);
});

test('ordinary errors and successful responses keep their original behavior', async () => {
  for (const response of [
    Response.json({ message: 'Permission denied' }, { status: 403 }),
    new Response('Server failed', { status: 500 }),
    new Response('Proxy failed', { status: 403 }),
    Response.json({ name: 'iPhone' }),
  ]) {
    const request = demoFetch({
      fetch: async () => response,
      onWriteDenied: () => {
        throw new Error('Unexpected demo notice');
      },
    });
    expect(await request('/api/entities/iphone')).toBe(response);
    expect(response.bodyUsed).toBe(false);
  }
});
