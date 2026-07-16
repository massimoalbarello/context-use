import { describe, expect, test } from "bun:test";
import { requireAuthenticationUserVerification } from "./webauthn-policy.ts";

describe("passkey authentication options", () => {
  test("requires user verification while preserving response headers", async () => {
    const response = Response.json({ challenge: "challenge", userVerification: "preferred" }, {
      headers: { "set-cookie": "challenge=signed; HttpOnly", "x-auth": "preserved" },
    });
    const hardened = await requireAuthenticationUserVerification(
      "/api/auth/passkey/generate-authenticate-options",
      response,
    );
    expect(await hardened.json()).toEqual({ challenge: "challenge", userVerification: "required" });
    expect(hardened.headers.get("set-cookie")).toContain("challenge=signed");
    expect(hardened.headers.get("x-auth")).toBe("preserved");
  });

  test("does not alter unrelated responses", async () => {
    const response = Response.json({ ok: true });
    expect(await requireAuthenticationUserVerification("/api/auth/get-session", response)).toBe(response);
  });
});
