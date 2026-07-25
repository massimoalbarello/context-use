import { describe, expect, test } from "bun:test";
import {
  extendLargeResponseIdleTimeout,
  LARGE_RESPONSE_IDLE_TIMEOUT_SECONDS,
} from "./streaming-timeout.ts";

describe("large response idle timeout", () => {
  test("allows a two-minute pause without disabling idle protection", () => {
    const calls: Array<{ request: Request; seconds: number }> = [];
    const request = new Request("https://context.example/export");

    extendLargeResponseIdleTimeout({
      timeout(receivedRequest, seconds) {
        calls.push({ request: receivedRequest, seconds });
      },
    }, request);

    expect(calls).toEqual([{
      request,
      seconds: LARGE_RESPONSE_IDLE_TIMEOUT_SECONDS,
    }]);
    expect(LARGE_RESPONSE_IDLE_TIMEOUT_SECONDS).toBe(120);
  });

  test("is a no-op when an Elysia app is handled without a live Bun server", () => {
    const request = new Request("https://context.example/export");
    expect(() => extendLargeResponseIdleTimeout(undefined, request)).not.toThrow();
  });
});
