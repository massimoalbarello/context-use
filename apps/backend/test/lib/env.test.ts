import { describe, expect, test } from 'bun:test';
import { loadEnv } from '#lib/env.ts';
import { BACKEND_ENVIRONMENT, NIBRUN_DATA_FOLDER } from '#lib/runtime-config.ts';

const WORKING_DIRECTORY = '/application';

describe('backend environment', () => {
  test('uses the persistent nibrun volume for application and authorization state', () => {
    const env = loadEnv({
      environment: { [BACKEND_ENVIRONMENT.nibrunHostname]: 'context-use-abc.nibrun.app' },
      workingDirectory: WORKING_DIRECTORY,
    });

    expect(env.DATA_FOLDER).toBe(NIBRUN_DATA_FOLDER);
    expect(env.BASE_URL.href).toBe('https://context-use-abc.nibrun.app/');
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
