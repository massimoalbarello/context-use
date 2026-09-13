import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOT = join(import.meta.dir, '../../src');

function stylesheetPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return stylesheetPaths(path);
    }
    return entry.name.endsWith('.css') ? [relative(SOURCE_ROOT, path)] : [];
  });
}

test('custom CSS stays confined to the canonical theme', () => {
  const theme = readFileSync(Bun.resolveSync('@repo/ui/theme.css', SOURCE_ROOT), 'utf8');

  expect(stylesheetPaths(SOURCE_ROOT).sort()).toEqual(['styles.css']);
  expect(readFileSync(join(SOURCE_ROOT, 'styles.css'), 'utf8')).toBe(
    '@import "tailwindcss" source(none);\n@import "@repo/ui/theme.css";\n@source "./";\n@source "../../../../packages/ui/src";\n',
  );
  expect(theme.startsWith('/*\n * Canonical tweakcn Minimal Neutral theme:')).toBe(true);
  expect(
    [...theme.matchAll(/^[ \t]*([^@\s][^{\r\n]*)[ \t]*\{$/gm)].map((match) => match[1]?.trim()),
  ).toEqual([':root', '.dark', '*', 'body']);
});
