import { mkdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function reserveIsolatedPort() {
  while (true) {
    const listener = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = listener.port!;
    const claim = join(tmpdir(), `context-use-isolated-port-${port}`);
    try {
      // A socket alone cannot reserve a port across the handoff to Vite/Bun.
      // Atomic mkdir keeps concurrent launchers (including other worktrees) apart
      // until their servers stop. A stale claim is harmless: choose another port.
      await mkdir(claim);
    } catch (error) {
      listener.stop(true);
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        continue;
      }
      throw error;
    }
    return {
      port,
      handoff: () => listener.stop(true),
      close: async () => {
        listener.stop(true);
        await rmdir(claim);
      },
    };
  }
}
