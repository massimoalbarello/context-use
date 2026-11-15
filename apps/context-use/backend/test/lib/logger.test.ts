import { expect, test } from 'bun:test';
import { createLogger } from '#backend/lib/logger.ts';
import { captureLogs } from '../support/logging.ts';

test('emits structured records with inherited context and filters below the configured level', () => {
  const lines: string[] = [];
  const logger = createLogger({
    scope: 'jobs',
    level: 'warn',
    destination: {
      write: (line) => {
        lines.push(line);
      },
    },
  });
  const child = logger.child({ ownerId: 'owner', jobId: 'job' });
  child.info({ event: 'job.started' }, 'Starting job');
  child.warn({ event: 'job.retry', attempt: 2 }, 'Retrying job');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toEqual({
    name: 'jobs',
    level: 'warn',
    time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    ownerId: 'owner',
    jobId: 'job',
    event: 'job.retry',
    attempt: 2,
    msg: 'Retrying job',
  });
});

test('redacts credential fields in events, child context, and HTTP headers without mutating input', () => {
  const logs = captureLogs();
  const fields = {
    refresh_token: 'private-refresh',
    accessToken: 'private-access',
    headers: {
      authorization: 'private-bearer',
      cookie: 'private-cookie',
      'set-cookie': 'private-session',
    },
    credentials: { client_secret: 'private-secret', password: 'private-password' },
    event: 'example',
  };
  logs.logger.child({ token: 'private-child' }).info(fields, 'Redaction example');
  expect(logs.lines.join('')).not.toContain('private-');
  expect(logs.records()[0]).toMatchObject({
    event: 'example',
    refresh_token: '[Redacted]',
    token: '[Redacted]',
    headers: { authorization: '[Redacted]' },
  });
  expect(fields.refresh_token).toBe('private-refresh');
});
