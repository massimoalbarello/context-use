import { expect, test } from 'bun:test';
import {
  diffPageMarkdown,
  MAX_REVISION_DIFF_EDIT_LENGTH,
} from '#backend/models/knowledge-pages/diff.ts';

test('diffs preserve whitespace and a changed final newline', () => {
  const result = diffPageMarkdown({
    before: '# Notes\n\nText  \n',
    after: '# Notes\n\nText',
  });
  expect(result).toMatchObject({
    additions: 1,
    deletions: 1,
    hunks: [{ lines: [' # Notes', ' ', '-Text  ', '+Text', '\\ No newline at end of file'] }],
  });
});

test('unusually large changes abort instead of producing an incomplete diff', () => {
  const after = 'Added line\n'.repeat(MAX_REVISION_DIFF_EDIT_LENGTH + 1);
  expect(diffPageMarkdown({ before: '', after })).toBeNull();
});
