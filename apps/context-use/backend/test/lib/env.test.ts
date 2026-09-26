import { describe, expect, test } from 'bun:test';
import { loadEnv } from '#backend/lib/env.ts';
import { BACKEND_ENVIRONMENT, NIBRUN_DATA_FOLDER } from '#backend/lib/runtime-config.ts';

const WORKING_DIRECTORY = '/application';

describe('backend environment', () => {
  test('keeps the injected hostname when a custom public URL is configured', () => {
    const env = loadEnv({
      environment: {
        [BACKEND_ENVIRONMENT.nibrunHostname]: 'context-use-test.nibrun.app',
        [BACKEND_ENVIRONMENT.baseUrl]: 'https://knowledge.example.com',
        [BACKEND_ENVIRONMENT.publicSiteName]: '  Orchard Notes  ',
      },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.NIBRUN_HOSTNAME).toBe('context-use-test.nibrun.app');
    expect(env.BASE_URL.origin).toBe('https://knowledge.example.com');
    expect(env.PUBLIC_SITE_NAME).toBe('Orchard Notes');
  });

  test('uses the persistent nibrun volume for application and authorization state', () => {
    const env = loadEnv({
      environment: { [BACKEND_ENVIRONMENT.nibrunHostname]: 'context-use-abc.nibrun.app' },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.DATA_FOLDER).toBe(NIBRUN_DATA_FOLDER);
    expect(env.BASE_URL.href).toBe('https://context-use-abc.nibrun.app/');
    expect(env.PUBLIC_SITE_NAME).toBe('Public knowledge');
  });

  test('allows a nibrun data subdirectory on the persistent volume', () => {
    const env = loadEnv({
      environment: {
        [BACKEND_ENVIRONMENT.dataFolder]: '/app/data/context-use',
        [BACKEND_ENVIRONMENT.nibrunHostname]: 'context-use-abc.nibrun.app',
      },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.DATA_FOLDER).toBe('/app/data/context-use');
  });

  test('rejects ephemeral nibrun data folders', () => {
    expect(() =>
      loadEnv({
        environment: {
          [BACKEND_ENVIRONMENT.dataFolder]: '/tmp/context-use',
          [BACKEND_ENVIRONMENT.nibrunHostname]: 'context-use-abc.nibrun.app',
        },
        workingDirectory: WORKING_DIRECTORY,
      }),
    ).toThrow('DATA_FOLDER must be inside /app/data on nibrun');
  });
});
