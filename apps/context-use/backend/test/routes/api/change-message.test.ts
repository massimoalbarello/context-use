import { expect, test } from 'bun:test';
import { Elysia, StatusMap, t } from 'elysia';
import { z } from 'zod';
import { MAX_CHANGE_MESSAGE_LENGTH } from '#backend/models/history/model.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import { withChangeMessage } from '#backend/routes/change-message.ts';

function fixture() {
  let writes = 0;
  const write = <T extends { changeMessage: string }>(body: T) => {
    writes++;
    return body;
  };
  const app = new Elysia()
    .use(changeMessagePlugin)
    .post('/json', ({ body }) => write(body), {
      changeMessage: true,
      body: t.Object({ name: t.String() }),
    })
    .post('/strict', ({ body }) => write(body), {
      changeMessage: true,
      body: withChangeMessage(z.strictObject({ name: z.string() })),
    })
    .post('/union', ({ body }) => write(body), {
      changeMessage: true,
      body: t.Union([
        t.Object({ decision: t.Literal('person'), entityReadableId: t.String() }),
        t.Object({ decision: t.Literal('unknown') }),
      ]),
    })
    .post('/upload', ({ body }) => write({ ...body, name: body.file.name }), {
      changeMessage: true,
      body: t.Object({ file: t.File() }),
    })
    .delete('/action', ({ body }) => write(body), { changeMessage: true });
  return { app, writes: () => writes };
}

function request({
  path,
  fields,
  message,
}: {
  path: string;
  fields: Record<string, string>;
  message?: string;
}) {
  const options = { method: path === '/action' ? 'DELETE' : 'POST' };
  const url = `http://localhost${path}`;
  if (path === '/upload') {
    const body = new FormData();
    body.set('file', new File(['content'], 'report.txt'));
    if (message !== undefined) {
      body.set('changeMessage', message);
    }
    return new Request(url, { ...options, body });
  }
  return new Request(url, {
    ...options,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...fields,
      ...(message === undefined ? {} : { changeMessage: message }),
    }),
  });
}

const cases: { path: string; fields: Record<string, string> }[] = [
  { path: '/json', fields: { name: 'Acme' } },
  { path: '/strict', fields: { name: 'Acme' } },
  { path: '/union', fields: { decision: 'person', entityReadableId: 'alice' } },
  { path: '/upload', fields: { name: 'report.txt' } },
  { path: '/action', fields: {} },
];
for (const { path, fields } of cases) {
  test(`the change-message plugin preserves ${path} inputs and rejects missing or invalid descriptions`, async () => {
    const f = fixture();
    for (const message of [undefined, '', ' \n\t ', 'x'.repeat(MAX_CHANGE_MESSAGE_LENGTH + 1)]) {
      const response = await f.app.handle(request({ path, fields, message }));
      expect(response.status).toBe(StatusMap['Unprocessable Content']);
    }
    expect(f.writes()).toBe(0);
    const response = await f.app.handle(
      request({ path, fields, message: '  Corrected the name  ' }),
    );
    expect(response.status).toBe(StatusMap.OK);
    const payload = await response.json();
    expect(payload).toMatchObject(fields);
    expect(payload.changeMessage.trim()).toBe('Corrected the name');
    expect(f.writes()).toBe(1);
  });
}

test('validating an action-only route does not restrict a later union body', async () => {
  const f = fixture();
  const action = await f.app.handle(
    request({ path: '/action', fields: {}, message: 'Requested an action' }),
  );
  expect(action.status).toBe(StatusMap.OK);

  const decisions: Record<string, string>[] = [
    { decision: 'person', entityReadableId: 'alice' },
    { decision: 'unknown' },
  ];
  for (const fields of decisions) {
    const response = await f.app.handle(
      request({ path: '/union', fields, message: 'Corrected face identification' }),
    );
    expect(response.status).toBe(StatusMap.OK);
    expect(await response.json()).toEqual({
      ...fields,
      changeMessage: 'Corrected face identification',
    });
  }
  expect(f.writes()).toBe(1 + decisions.length);
});
