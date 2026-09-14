import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restoreWorkspace, retireWorkspace, retireWorkspaceInstructions } from '../src/workspace';

import { LEGACY_AGENTS, LEGACY_USER } from './fixtures/workspace';

test('retires operational instructions while preserving user facts, channel policy and examples', () => {
  const agents = retireWorkspaceInstructions(LEGACY_AGENTS);
  const user = retireWorkspaceInstructions(LEGACY_USER);
  expect(agents).not.toContain('context_use_');
  expect(agents).not.toContain('Context-use Only');
  expect(agents).not.toContain('memory.example');
  expect(agents).toContain('currently available memory tools normally');
  expect(agents).toContain('Do not ask for privacy confirmation');
  expect(agents).toContain('Be concise. Preserve this sentence');
  expect(agents).toContain('Rowan likes making ceramics.');
  expect(user).toContain('Prefers concise answers. Likes architecture.');
  expect(user).toContain('Rowan is building Context Use');
  expect(user).not.toContain('sole durable');
  expect(user).not.toContain('Never write');
  const example = '```markdown\n## Context Use\nUse the native context_use_* tools.\n```\n';
  expect(retireWorkspaceInstructions(example)).toBe(example);
  expect(retireWorkspaceInstructions(agents)).toBe(agents);
  expect(retireWorkspaceInstructions(user)).toBe(user);
});

test('backs up before replacing files, supports repeat removal and preserves later edits on recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-workspace-test-'));
  const workspace = join(directory, 'workspace');
  const backups = join(directory, 'backups');
  try {
    await mkdir(join(workspace, 'memory'), { recursive: true });
    await writeFile(join(workspace, 'AGENTS.md'), LEGACY_AGENTS);
    await writeFile(join(workspace, 'USER.md'), LEGACY_USER);
    await writeFile(
      join(workspace, 'MEMORY.md'),
      "Context-use is Rowan's sole durable personal memory.",
    );
    const historical =
      'Yesterday we discussed configuring Context Use as our sole durable personal memory.';
    await writeFile(join(workspace, 'memory/2026-09-01.md'), historical);
    const backup = await retireWorkspace({ workspace, backups });
    expect(backup).toBeDefined();
    const journal = JSON.parse(await readFile(join(backup!, 'workspace.json'), 'utf8'));
    expect(journal.files.find((file: { name: string }) => file.name === 'AGENTS.md').before).toBe(
      LEGACY_AGENTS,
    );
    expect(
      journal.files.filter((file: { name: string }) => file.name.toLowerCase() === 'memory.md'),
    ).toHaveLength(1);
    const permissionMask = 0o777;
    const privateMode = 0o600;
    expect((await stat(join(backup!, 'workspace.json'))).mode & permissionMask).toBe(privateMode);
    expect(await retireWorkspace({ workspace, backups })).toBeUndefined();
    expect(await readdir(backups)).toHaveLength(1);
    expect(await readFile(join(workspace, 'memory/2026-09-01.md'), 'utf8')).toBe(historical);
    const later = `${await readFile(join(workspace, 'USER.md'), 'utf8')}\nLikes cycling.\n`;
    await writeFile(join(workspace, 'USER.md'), later);
    expect(await restoreWorkspace(backup!)).toEqual([join(workspace, 'USER.md')]);
    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toBe(LEGACY_AGENTS);
    expect(await readFile(join(workspace, 'USER.md'), 'utf8')).toBe(later);
    expect(await restoreWorkspace(backup!)).toEqual([join(workspace, 'USER.md')]);
    // A later remove can retire restored instructions again without losing recovery.
    expect(await retireWorkspace({ workspace, backups })).toBeDefined();
    expect(await readdir(backups)).toHaveLength(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses to rewrite linked workspace files or paths outside the startup-file contract', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-workspace-links-'));
  try {
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    const target = join(directory, 'external.md');
    await writeFile(target, LEGACY_USER);
    await symlink(target, join(workspace, 'USER.md'));
    await expect(
      retireWorkspace({ workspace, backups: join(directory, 'backups') }),
    ).rejects.toThrow('regular, unlinked file');
    expect(await readFile(target, 'utf8')).toBe(LEGACY_USER);
    await writeFile(target, 'The user likes pottery.');
    expect(
      await retireWorkspace({ workspace, backups: join(directory, 'backups') }),
    ).toBeUndefined();
    await writeFile(target, LEGACY_USER);
    await writeFile(
      join(directory, 'workspace.json'),
      JSON.stringify({
        workspace,
        files: [{ name: '../external.md', before: 'changed', after: LEGACY_USER, mode: 420 }],
      }),
    );
    await expect(restoreWorkspace(directory)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(LEGACY_USER);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
