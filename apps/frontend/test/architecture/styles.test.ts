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

test('custom CSS stays confined to the shared theme foundation', () => {
  expect(stylesheetPaths(SOURCE_ROOT).sort()).toEqual(['styles.css', 'styles/foundation.css']);
  expect(readFileSync(join(SOURCE_ROOT, 'styles.css'), 'utf8')).toBe(
    '@import "tailwindcss";\n@import "./styles/foundation.css";\n',
  );
});
