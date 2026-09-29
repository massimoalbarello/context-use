import { describe, expect, test } from 'bun:test';
import { apiErrorMessage } from '../../src/lib/api-error';

const BAD_GATEWAY_STATUS = 502;
const BAD_REQUEST_STATUS = 400;
const INTERNAL_SERVER_ERROR_STATUS = 500;

describe('apiErrorMessage', () => {
  test.each([
    '<!DOCTYPE html><html><body>Bad gateway</body></html>',
    'Bad gateway',
    null,
    undefined,
    false,
    BAD_GATEWAY_STATUS,
    { error: { message: 'Bad gateway' } },
    { message: ['Bad gateway'] },
  ])('falls back to the status for an unexpected body: %j', (value) => {
    expect(apiErrorMessage({ value, status: BAD_GATEWAY_STATUS })).toBe(
      'Request failed with status 502',
    );
  });

  test('uses the application error message when present', () => {
    const message = apiErrorMessage({
      value: { error: 'Page not found' },
      status: BAD_REQUEST_STATUS,
    });

    expect(message).toBe('Page not found');
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
