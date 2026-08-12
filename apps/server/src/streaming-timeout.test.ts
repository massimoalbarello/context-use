import { describe, expect, test } from "bun:test";
import {
  disableStreamingRequestIdleTimeout,
  STREAMING_REQUEST_IDLE_TIMEOUT_SECONDS,
} from "./streaming-timeout.ts";

describe("large response idle timeout", () => {
  test("disables the idle timer for bounded streaming work", () => {
    const calls: Array<{ request: Request; seconds: number }> = [];
    const request = new Request("https://context.example/export");

    disableStreamingRequestIdleTimeout({
      timeout(receivedRequest, seconds) {
        calls.push({ request: receivedRequest, seconds });
      },
    }, request);

    expect(calls).toEqual([{
      request,
      seconds: STREAMING_REQUEST_IDLE_TIMEOUT_SECONDS,
    }]);
    expect(STREAMING_REQUEST_IDLE_TIMEOUT_SECONDS).toBe(0);
  });

  test("is a no-op when an Elysia app is handled without a live Bun server", () => {
    const request = new Request("https://context.example/export");
    expect(() => disableStreamingRequestIdleTimeout(undefined, request)).not.toThrow();
  });
});
