import { afterEach, expect, mock, test } from 'bun:test';
import '../support/dom';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FaceSettingsForm } from '../../src/components/faces/face-settings';
import type { FaceSettings } from '../../src/queries/faces';

afterEach(cleanup);
const settings: FaceSettings = {
  model: {
    name: 'Test model',
    analysisVersion: 'test-v1',
    embeddingSpace: 'test-space',
    dimensions: 2,
    metric: 'cosine',
    defaultThreshold: 0.363,
    supportedMediaTypes: ['image/jpeg'],
  },
  threshold: 0.363,
};
const STRICT_THRESHOLD = 0.8;

test('threshold editing distinguishes saving from updating existing automatic assignments', async () => {
  const onSave = mock(() => undefined);
  const user = userEvent.setup({ document });
  const view = render(
    <FaceSettingsForm settings={settings} pending={false} error={null} onSave={onSave} />,
  );
  const input = view.getByRole('textbox', { name: 'Match threshold' });
  await user.clear(input);
  await user.type(input, String(STRICT_THRESHOLD));
  await user.click(view.getByRole('button', { name: 'Save threshold' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenLastCalledWith({
      threshold: STRICT_THRESHOLD,
      rematch: false,
      analysisVersion: settings.model.analysisVersion,
    }),
  );
  await user.click(view.getByRole('button', { name: 'Save & re-match' }));
  await waitFor(() =>
    expect(onSave).toHaveBeenLastCalledWith({
      threshold: STRICT_THRESHOLD,
      rematch: true,
      analysisVersion: settings.model.analysisVersion,
    }),
  );
});

test('an empty threshold is rejected before requesting a re-match', async () => {
  const onSave = mock(() => undefined);
  const user = userEvent.setup({ document });
  const view = render(
    <FaceSettingsForm settings={settings} pending={false} error={null} onSave={onSave} />,
  );
  await user.click(view.getByRole('textbox', { name: 'Match threshold' }));
  await user.keyboard('{Control>}a{/Control}{Backspace}');
  expect((view.getByRole('textbox', { name: 'Match threshold' }) as HTMLInputElement).value).toBe(
    '',
  );
  await user.click(view.getByRole('button', { name: 'Save & re-match' }));
  expect((await view.findByRole('alert')).textContent).toContain(
    'Enter a threshold between -1 and 1.',
  );
  expect(onSave).not.toHaveBeenCalled();
});
