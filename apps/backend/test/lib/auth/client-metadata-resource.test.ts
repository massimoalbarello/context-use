import { describe, expect, test } from 'bun:test';
import type { LookupAddress } from 'node:dns';
import {
  fetchClientMetadataResource,
  pinnedAddressLookup,
  pinnedPublicAddress,
  pinnedRequestOptions,
} from '#lib/auth/client-metadata-resource.ts';

const PUBLIC_ADDRESS: LookupAddress = { address: '8.8.8.8', family: 4 };

describe('CIMD client metadata transport', () => {
  test('rejects empty or partly private DNS results before selecting an address', () => {
    expect(() => pinnedPublicAddress({ addresses: [] })).toThrow(
      'metadata hostname returned no DNS addresses',
    );
    expect(() =>
      pinnedPublicAddress({
        addresses: [PUBLIC_ADDRESS, { address: '127.0.0.1', family: 4 }],
      }),
    ).toThrow('metadata hostname must resolve only to public-routable addresses');
  });

  test("pins one approved address using Bun's all-address lookup callback contract", async () => {
    const lookup = pinnedAddressLookup({ address: PUBLIC_ADDRESS });
    const pendingAddresses = Promise.withResolvers<string | LookupAddress[]>();
    lookup('client.example', { all: true }, (...parameters) => {
      const [error, result] = parameters;
      if (error) {
        pendingAddresses.reject(error);
      } else {
        pendingAddresses.resolve(result);
      }
    });
    const addresses = await pendingAddresses.promise;

    expect(addresses).toEqual([PUBLIC_ADDRESS]);

    const pendingAddress = Promise.withResolvers<{ address: string; family?: number }>();
    lookup('client.example', {}, (...parameters) => {
      const [error, address, family] = parameters;
      if (error) {
        pendingAddress.reject(error);
      } else {
        pendingAddress.resolve({ address: address as string, family: family as number });
      }
    });
    expect(await pendingAddress.promise).toEqual(PUBLIC_ADDRESS);
  });

  test('keeps the original HTTPS identity on an isolated pinned connection', () => {
    const signal = new AbortController().signal;
    const options = pinnedRequestOptions({
      address: PUBLIC_ADDRESS,
      signal,
      url: new URL('https://client.example:8443/client.json'),
      webRequest: new Request('https://client.example:8443/client.json', {
        headers: { host: 'untrusted.example' },
      }),
    });

    expect(options.agent).toBe(false);
    expect(options.method).toBe('GET');
    expect(options.servername).toBe('client.example');
    expect(options.signal).toBe(signal);
    expect((options.headers as Record<string, string>).host).toBe('client.example:8443');
    expect(options.rejectUnauthorized).not.toBe(false);
  });

  test('accepts only HTTPS GET and HEAD requests', async () => {
    await expect(fetchClientMetadataResource('http://client.example/client.json')).rejects.toThrow(
      'CIMD transport requires an HTTPS URL',
    );
    await expect(
      fetchClientMetadataResource('https://client.example/client.json', { method: 'POST' }),
    ).rejects.toThrow('CIMD transport supports only GET and HEAD');
    await expect(fetchClientMetadataResource('https://127.0.0.1/client.json')).rejects.toThrow(
      'metadata hostname must resolve only to public-routable addresses',
    );
  });
});
