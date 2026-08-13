import { describe, expect, test } from "bun:test";
import {
  KnowledgeExportPreparationError,
  KnowledgeExportPreparationQueue,
} from "./knowledge-export-preparation.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("knowledge export preparation queue", () => {
  test("deduplicates a running archive build and becomes idle after completion", async () => {
    const pending = deferred<{ sizeBytes: number; contentHash: string }>();
    const queue = new KnowledgeExportPreparationQueue();
    let builds = 0;
    const build = () => {
      builds += 1;
      return pending.promise;
    };

    queue.start("export-id", build);
    queue.start("export-id", build);
    expect(builds).toBe(1);
    expect(queue.state("export-id")).toEqual({ status: "processing" });

    pending.resolve({ sizeBytes: 42, contentHash: "a".repeat(64) });
    await pending.promise;
    await settleQueue();
    expect(queue.state("export-id")).toEqual({ status: "idle" });
  });

  test("keeps a safe failure available for polling until an explicit retry", async () => {
    const queue = new KnowledgeExportPreparationQueue();
    let builds = 0;
    const build = async () => {
      builds += 1;
      throw new KnowledgeExportPreparationError("An asset is unavailable", 409, "asset_incomplete");
    };

    queue.start("export-id", build);
    await settleQueue();
    expect(queue.state("export-id")).toEqual({
      status: "failed",
      message: "An asset is unavailable",
      httpStatus: 409,
      code: "asset_incomplete",
    });

    queue.start("export-id", build);
    expect(builds).toBe(1);
    queue.start("export-id", build, true);
    expect(builds).toBe(2);
  });

  test("does not expose unexpected storage errors to the browser", async () => {
    const errors: unknown[] = [];
    const queue = new KnowledgeExportPreparationQueue((_intentId, error) => errors.push(error));
    queue.start("export-id", async () => { throw new Error("private storage detail"); });
    await settleQueue();

    expect(queue.state("export-id")).toEqual({
      status: "failed",
      message: "The knowledge archive could not be prepared. Try preparing it again.",
      httpStatus: 500,
      code: "export_preparation_failed",
    });
    expect(errors).toHaveLength(1);
  });
});
