import { describe, expect, test } from 'bun:test';
import type { LookupAddress } from 'node:dns';
import {
  fetchClientMetadataResource,
  pinnedAddressLookup,
  pinnedPublicAddress,
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
  });

  test('accepts only HTTPS GET and HEAD requests', async () => {
    await expect(fetchClientMetadataResource('http://client.example/client.json')).rejects.toThrow(
      'CIMD transport requires an HTTPS URL',
    );
    await expect(
      fetchClientMetadataResource('https://client.example/client.json', { method: 'POST' }),
    ).rejects.toThrow('CIMD transport supports only GET and HEAD');
  });
});
