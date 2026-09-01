import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { type RequestOptions, request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import type { CimdOptions } from '@better-auth/cimd';
import { isPublicRoutableHost } from '@better-auth/core/utils/host';

const HTTP_NO_CONTENT = 204;
const HTTP_RESET_CONTENT = 205;
const HTTP_NOT_MODIFIED = 304;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const BODY_FORBIDDEN_RESPONSE_STATUSES = new Set([
  HTTP_NO_CONTENT,
  HTTP_RESET_CONTENT,
  HTTP_NOT_MODIFIED,
]);

function responseHeaders({ headers }: { headers: NodeJS.Dict<string | string[]> }): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
    } else if (value !== undefined) {
      result.append(name, value);
    }
  }
  return result;
}

export function pinnedPublicAddress({
  addresses,
}: {
  addresses: readonly LookupAddress[];
}): LookupAddress {
  if (addresses.length === 0) {
    throw new TypeError('metadata hostname returned no DNS addresses');
  }
  for (const result of addresses) {
    if (!isPublicRoutableHost(result.address)) {
      throw new TypeError('metadata hostname must resolve only to public-routable addresses');
    }
  }
  return addresses[0]!;
}

export function pinnedAddressLookup({ address }: { address: LookupAddress }): LookupFunction {
  return (...parameters) => {
    const [, options, callback] = parameters;
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

export function pinnedRequestOptions({
  address,
  signal,
  url,
  webRequest,
}: {
  address: LookupAddress;
  signal: AbortSignal;
  url: URL;
  webRequest: Request;
}): RequestOptions {
  const headers = Object.fromEntries(webRequest.headers.entries());
  headers.host = url.host;
  return {
    agent: false,
    headers,
    method: webRequest.method,
    servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0 ? url.hostname : undefined,
    signal,
    lookup: pinnedAddressLookup({ address }),
  };
}

/**
 * Bun CIMD transport required by Better Auth's runtime-specific security contract.
 *
 * This mirrors `@better-auth/cimd/node@1.7.2` with the callback correction proposed in
 * better-auth/better-auth#10730. The published transport answers an `{ all: true }` DNS lookup
 * with the legacy scalar shape, which fails before connecting with `ERR_INVALID_IP_ADDRESS`.
 * Replace this module with the upstream transport once that fix ships with documented Bun support.
 *
 * The hostname is resolved once, every answer is validated, and the chosen address is pinned
 * while Host, TLS SNI, and certificate verification continue to use the original hostname.
 */
export const fetchClientMetadataResource: CimdOptions['fetchClientMetadataResource'] = async (
  ...parameters
) => {
  const [input, init] = parameters;
  const webRequest = new Request(input, init);
  const url = new URL(webRequest.url);
  if (url.protocol !== 'https:') {
    throw new TypeError('CIMD transport requires an HTTPS URL');
  }
  if (webRequest.method !== 'GET' && webRequest.method !== 'HEAD') {
    throw new TypeError('CIMD transport supports only GET and HEAD');
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const pinnedAddress = pinnedPublicAddress({ addresses });
  const signal = init?.signal ?? (input instanceof Request ? input.signal : webRequest.signal);

  const pendingResponse = Promise.withResolvers<Response>();
  const outboundRequest = request(
    url,
    pinnedRequestOptions({ address: pinnedAddress, signal, url, webRequest }),
    (incomingResponse) => {
      const status = incomingResponse.statusCode ?? HTTP_INTERNAL_SERVER_ERROR;
      const body =
        webRequest.method === 'HEAD' || BODY_FORBIDDEN_RESPONSE_STATUSES.has(status)
          ? null
          : Readable.toWeb(incomingResponse);
      pendingResponse.resolve(
        new Response(body as ConstructorParameters<typeof Response>[0], {
          headers: responseHeaders({ headers: incomingResponse.headers }),
          status,
          statusText: incomingResponse.statusMessage,
        }),
      );
    },
  );
  outboundRequest.once('error', pendingResponse.reject);
  outboundRequest.end();
  return await pendingResponse.promise;
};
