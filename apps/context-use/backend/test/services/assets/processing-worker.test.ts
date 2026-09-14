import { expect, test } from 'bun:test';
import { FaceProcessingWorker } from '#backend/services/assets/processing-worker.ts';

test('wake-ups are serialized and shutdown waits for the current task without starting another', async () => {
  const firstStarted = Promise.withResolvers<void>();
  const releaseFirst = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const releaseSecond = Promise.withResolvers<void>();
  let calls = 0;
  const worker = new FaceProcessingWorker(async () => {
    calls++;
    if (calls === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
      return false;
    }
    secondStarted.resolve();
    await releaseSecond.promise;
    return true;
  });
  try {
    worker.start();
    await firstStarted.promise;
    worker.start();
    worker.wake();
    worker.wake();
    expect(calls).toBe(1);
    releaseFirst.resolve();
    await secondStarted.promise;
    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    worker.wake();
    await Promise.resolve();
    expect(closed).toBe(false);
    releaseSecond.resolve();
    await closing;
    expect(calls).toBe(2);
    expect(() => worker.start()).toThrow('cannot be restarted');
  } finally {
    releaseFirst.resolve();
    releaseSecond.resolve();
    await worker.close();
  }
});

test('closing before startup prevents acquiring a polling timer or running work', async () => {
  let calls = 0;
  const worker = new FaceProcessingWorker(() => {
    calls++;
    return Promise.resolve(false);
  });
  await worker.close();
  worker.wake();
  expect(() => worker.start()).toThrow('cannot be restarted');
  expect(calls).toBe(0);
});

test('a task error does not strand persisted work or stop subsequent polling', async () => {
  const recovered = Promise.withResolvers<void>();
  let attempts = 0;
  const worker = new FaceProcessingWorker(() => {
    attempts++;
    if (attempts === 1) {
      return Promise.reject(new Error('Temporary persistence failure'));
    }
    recovered.resolve();
    return Promise.resolve(false);
  });
  try {
    worker.start();
    await recovered.promise;
    expect(attempts).toBe(2);
  } finally {
    await worker.close();
  }
});
