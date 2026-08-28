import { describe, expect, test } from 'bun:test';
import { apiErrorMessage } from '../../src/lib/api-error';

const BAD_REQUEST_STATUS = 400;
const INTERNAL_SERVER_ERROR_STATUS = 500;

describe('apiErrorMessage', () => {
  test('uses the application error message when present', () => {
    const message = apiErrorMessage({
      value: { error: 'File not found' },
      status: BAD_REQUEST_STATUS,
    });

    expect(message).toBe('File not found');
  });

  test('uses the validation message when present', () => {
    const message = apiErrorMessage({
      value: { message: 'Invalid request' },
      status: BAD_REQUEST_STATUS,
    });

    expect(message).toBe('Invalid request');
  });

  test('falls back to the response status', () => {
    const message = apiErrorMessage({ value: {}, status: INTERNAL_SERVER_ERROR_STATUS });

    expect(message).toBe('Request failed with status 500');
  });
});
