import { afterEach, expect, test } from "bun:test";
import { forwardBrowserConfirmation } from "./confirmation-gateway.ts";

const testGlobal = globalThis as typeof globalThis & {
  __contextUseConfirmationHandler?: (request: Request) => Promise<Response> | Response;
};

afterEach(() => {
  delete testGlobal.__contextUseConfirmationHandler;
});

test("confirmation forwarding strips reusable browser credentials", async () => {
  let forwarded: Request | undefined;
  testGlobal.__contextUseConfirmationHandler = (request) => {
    forwarded = request;
    return new Response(null, { status: 204 });
  };

  const response = await forwardBrowserConfirmation(
    "publication",
    { intent_id: "11111111-1111-4111-8111-111111111111", response: { id: "credential" } },
    { userId: "context-use-owner", sessionId: "session-id", email: "owner@example.com" },
  );

  expect(response.status).toBe(204);
  expect(forwarded).toBeDefined();
  expect(forwarded!.headers.has("cookie")).toBe(false);
  expect(forwarded!.headers.has("x-csrf-token")).toBe(false);
  expect(forwarded!.headers.has("origin")).toBe(false);
  expect(forwarded!.headers.get("authorization")).toStartWith("Bearer ");
  expect(await forwarded!.json()).toEqual({
    principal: { owner_user_id: "context-use-owner", session_id: "session-id" },
    confirmation: {
      intent_id: "11111111-1111-4111-8111-111111111111",
      response: { id: "credential" },
    },
  });
});
