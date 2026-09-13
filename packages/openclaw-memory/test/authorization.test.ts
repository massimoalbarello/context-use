import { expect, test } from 'bun:test';
import {
  assertHostVersion,
  CALLBACK_URL,
  SUPPORTED_OPENCLAW_VERSION,
  serverUrl,
} from '../src/contract';
import { authorizationResponse } from '../src/oauth';

const NOW = 1_000_000;
const pending = {
  url: 'https://memory.example/authorize',
  state: 'this-connection-only',
  createdAt: NOW,
};
function response(query: string) {
  return { redirectUrl: `${CALLBACK_URL}?${query}`, pending, now: NOW };
}

test('accepts the matching pasted callback without a local HTTP listener', () => {
  expect(authorizationResponse(response('state=this-connection-only&code=single-use'))).toEqual({
    authorizationCode: 'single-use',
    iss: undefined,
  });
});

test('rejects swapped, replayed, expired and ambiguous authorization responses', () => {
  for (const query of [
    'state=another&code=x',
    'state=this-connection-only&code=x&code=y',
    'state=this-connection-only&error=access_denied',
    'state=this-connection-only',
  ]) {
    expect(() => authorizationResponse(response(query))).toThrow();
  }
  expect(() =>
    authorizationResponse({ ...response('state=this-connection-only&code=x'), pending: undefined }),
  ).toThrow();
  expect(() =>
    authorizationResponse({ ...response('state=this-connection-only&code=x'), now: NOW * 2 }),
  ).toThrow();
  expect(() =>
    authorizationResponse({
      ...response('state=this-connection-only&code=x'),
      redirectUrl: 'https://attacker.example/?code=x&state=this-connection-only',
    }),
  ).toThrow();
});

test('supports exactly the tested host version and secure instance locations', () => {
  expect(() => assertHostVersion(SUPPORTED_OPENCLAW_VERSION)).not.toThrow();
  expect(() => assertHostVersion('2026.8.1')).toThrow();
  expect(serverUrl('https://memory.example')).toBe('https://memory.example/mcp');
  expect(serverUrl('http://localhost:3000')).toBe('http://localhost:3000/mcp');
  for (const input of [
    'http://memory.example',
    'https://a:b@memory.example',
    'https://memory.example/?secret=x',
  ]) {
    expect(() => serverUrl(input)).toThrow();
  }
});
