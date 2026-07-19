const hopByHopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export function internalProxyRequest(
  request: Request,
  authorityUrl: string,
  mutateHeaders?: (headers: Headers) => void,
): Request {
  const incoming = new URL(request.url);
  const upstream = new URL(authorityUrl);
  // Assign path/query fields instead of resolving an attacker-controlled string
  // so a leading // can never replace the configured internal authority host.
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  upstream.hash = "";

  const headers = new Headers(request.headers);
  // Connect to the isolated authority URL while preserving the browser-facing
  // Host. Bun constructs the authority's Request URL from this value, so its
  // exact public-origin check still sees (and validates) the original host.
  // The fetch destination remains `upstream`; Host cannot redirect the socket.
  headers.set("host", incoming.host);
  for (const header of hopByHopHeaders) headers.delete(header);
  mutateHeaders?.(headers);
  return new Request(upstream, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    redirect: "manual",
  });
}

export function forwardInternalRequest(
  request: Request,
  authorityUrl: string,
  mutateHeaders?: (headers: Headers) => void,
): Promise<Response> {
  return fetch(internalProxyRequest(request, authorityUrl, mutateHeaders));
}
