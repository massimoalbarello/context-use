import { describe, expect, test } from "bun:test";
import { streamKnowledgeZip } from "./knowledge-zip.ts";

describe("knowledge ZIP streaming", () => {
  test("propagates entry-writer failures to the consumer", async () => {
    const stream = streamKnowledgeZip(async () => {
      throw new Error("archive write failed");
    });

    await expect(new Response(stream).arrayBuffer()).rejects.toThrow("archive write failed");
  });

  test("aborts and waits for the producer when the consumer cancels", async () => {
    let aborted = false;
    const stream = streamKnowledgeZip(async (_zip, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
    });

    await stream.cancel("download cancelled");
    expect(aborted).toBeTrue();
  });
});
