const publicAuthMethods = new Map<string, ReadonlySet<string>>([
  ["/.well-known/oauth-authorization-server", new Set(["GET"])],
  ["/.well-known/openid-configuration", new Set(["GET"])],
  ["/api/auth/get-session", new Set(["GET"])],
  ["/api/auth/sign-out", new Set(["POST"])],
  ["/api/auth/passkey/generate-register-options", new Set(["GET"])],
  ["/api/auth/passkey/verify-registration", new Set(["POST"])],
  ["/api/auth/passkey/generate-authenticate-options", new Set(["GET"])],
  ["/api/auth/passkey/verify-authentication", new Set(["POST"])],
  ["/api/auth/jwks", new Set(["GET"])],
  ["/api/auth/oauth2/authorize", new Set(["GET", "POST"])],
  ["/api/auth/oauth2/consent", new Set(["POST"])],
  ["/api/auth/oauth2/continue", new Set(["POST"])],
  ["/api/auth/oauth2/token", new Set(["POST"])],
  ["/api/auth/oauth2/introspect", new Set(["POST"])],
  ["/api/auth/oauth2/revoke", new Set(["POST"])],
  ["/api/auth/oauth2/userinfo", new Set(["GET", "POST"])],
  ["/api/auth/oauth2/end-session", new Set(["GET"])],
  ["/api/auth/oauth2/register", new Set(["POST"])],
  ["/api/auth/oauth2/public-client", new Set(["GET"])],
  ["/api/auth/oauth2/public-client-prelogin", new Set(["POST"])],
  ["/api/auth/error", new Set(["GET"])],
]);

export function publicAuthRequestAllowed(request: Request): boolean {
  return publicAuthMethods.get(new URL(request.url).pathname)?.has(request.method) === true;
}
