import { expect, test } from 'bun:test';
import {
  meetingIdFromUrl,
  meetingIdSchema,
} from '#backend/services/syncs/sources/granola/meetings/identity.ts';

const uuid = 'f3e45e0f-24cc-480b-9a6c-8b1f5e3d7a2c';

test('MCP UUIDs and public API note URLs resolve to the same canonical record ID', () => {
  expect(meetingIdSchema.parse(uuid.toUpperCase())).toBe(uuid);
  expect(meetingIdFromUrl(`https://notes.granola.ai/d/${uuid.toUpperCase()}`)).toBe(uuid);
  expect(meetingIdFromUrl(`https://notes.granola.ai/d/${uuid}/?share=1#notes`)).toBe(uuid);
  expect(() => meetingIdSchema.parse('not_1d3tmYTlCICgjy')).toThrow();
});

test.each([
  `https://notes.granola.ai.attacker.example/d/${uuid}`,
  `http://notes.granola.ai/d/${uuid}`,
  `https://user@notes.granola.ai/d/${uuid}`,
  `https://notes.granola.ai/d/${uuid}/another-note`,
  'https://notes.granola.ai/d/not_1d3tmYTlCICgjy',
  'https://notes.granola.ai/d/not-a-uuid',
  'not_1d3tmYTlCICgjy',
])('unmappable API URLs fail instead of introducing another record identity: %s', (value) => {
  expect(() => meetingIdFromUrl(value)).toThrow();
});
