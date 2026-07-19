const AUTHORIZATION_RESPONSE_ISS_SUPPORT = "authorization_response_iss_parameter_supported";

/**
 * Temporary compatibility override for Codex's MCP OAuth callback handling.
 *
 * TODO: Remove this once openai/codex's perform_oauth_login.rs preserves the
 * RFC 9207 `iss` callback parameter and calls `handle_callback_with_issuer`.
 * Codex currently drops `iss`, while rmcp rejects the callback when this
 * metadata flag is true:
 * https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/perform_oauth_login.rs
 */
export async function withCodexIssuerCompatibility(
  response: Response | Promise<Response>,
): Promise<Response> {
  const resolved = await response;
  const metadata = await resolved.json() as Record<string, unknown>;
  const headers = new Headers(resolved.headers);
  headers.delete("content-length");

  return new Response(JSON.stringify({
    ...metadata,
    [AUTHORIZATION_RESPONSE_ISS_SUPPORT]: false,
  }), {
    status: resolved.status,
    statusText: resolved.statusText,
    headers,
  });
}
