import { describe, expect, test } from "bun:test";
import { forwardInternalRequest, internalProxyRequest } from "./internal-proxy.ts";
import { requestMatchesOrigin } from "./security.ts";

describe("internal authority proxy", () => {
  test("an attacker-controlled path cannot replace the configured authority host", () => {
    const proxied = internalProxyRequest(
      new Request("http://public.example//attacker.example/api/dashboard/pages?limit=1"),
      "http://app:3000",
    );
    expect(new URL(proxied.url).origin).toBe("http://app:3000");
    expect(new URL(proxied.url).pathname).toBe("//attacker.example/api/dashboard/pages");
  });

  test("connects internally while preserving the public host for authority validation", async () => {
    let receivedUrl: string | undefined;
    let receivedOriginMatches = false;
    const authority = Bun.serve({
      port: 0,
      fetch(request) {
        receivedUrl = request.url;
        receivedOriginMatches = requestMatchesOrigin(request, "https://context.example");
        return new Response("ok");
      },
    });
    try {
      const response = await forwardInternalRequest(
        new Request("http://context.example/api/dashboard/pages", {
          headers: { "x-forwarded-proto": "https" },
        }),
        `http://127.0.0.1:${authority.port}`,
      );
      expect(response.status).toBe(200);
      expect(new URL(receivedUrl!).origin).toBe("http://context.example");
      expect(receivedOriginMatches).toBe(true);
    } finally {
      authority.stop(true);
    }
  });
});
