import { expect, test } from 'bun:test';
import { startModel } from '../scripts/e2e-model.ts';

test('setup accepts success output before exit and never carries it into another command', async () => {
  const model = startModel();
  const reply = async (output = '') => {
    const response = await fetch(model.origin, {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: output ? 'tool' : 'user', content: output }],
        tools: ['exec', 'process'].map((name) => ({
          function: { name, parameters: { properties: {} } },
        })),
      }),
    });
    return { ok: response.ok, body: await response.text() };
  };
  try {
    model.setup('connect');
    expect((await reply()).ok).toBe(true);
    expect(
      (await reply('Context Use connected\nCommand still running (session setup-1, pid 1)')).body,
    ).toContain('process');
    const completed = await reply('(no new output)\n\nProcess exited with code 0.');
    expect(completed.ok).toBe(true);
    expect(completed.body).toContain('Plugin setup completed');

    model.setup('connect again');
    await reply();
    expect((await reply('Process exited with code 0.')).ok).toBe(false);

    model.setup('failed connect');
    await reply();
    await reply('Context Use connected\nCommand still running (session setup-2, pid 2)');
    expect((await reply('Process exited with code 1.')).ok).toBe(false);
  } finally {
    model.stop();
  }
});
