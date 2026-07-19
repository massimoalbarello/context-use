import { describe, expect, test } from "bun:test";
import { withCodexIssuerCompatibility } from "./oauth-metadata.ts";

describe("OAuth authorization server metadata", () => {
  test("temporarily advertises authorization response issuer support as disabled", async () => {
    const response = await withCodexIssuerCompatibility(Response.json({
      issuer: "https://context.example.com",
      authorization_response_iss_parameter_supported: true,
    }, {
      headers: { "cache-control": "public, max-age=60" },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await response.json()).toEqual({
      issuer: "https://context.example.com",
      authorization_response_iss_parameter_supported: false,
    });
  });
});
