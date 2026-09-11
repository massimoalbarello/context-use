import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { RecordCardContent } from '../../src/components/records/record-link';
import type { ExternalRecord } from '../../src/queries/records';
import { RecordMetadata } from '../../src/routes/records.$id';

afterEach(cleanup);

const record: ExternalRecord = {
  readableId: 'meeting-a1b2c3',
  title: 'Project review',
  provider: 'granola',
  kind: 'meeting',
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  recordId: 'source-meeting',
  sync: { readableId: 'notes-sync-a1b2c3', name: 'Meeting notes' },
  createdAt: new Date('2026-09-09T11:00:00.000Z'),
  updatedAt: new Date('2026-09-09T12:00:00.000Z'),
  markdown: 'Discussion notes.',
  participantNames: ['Samantha Wells', 'Alex Rivera'],
};

test('participant names belong in record metadata, not sidebar card previews', () => {
  const { unmount } = render(<RecordMetadata record={record} />);
  expect(screen.getByText('Participants').nextElementSibling?.textContent).toBe(
    'Samantha Wells, Alex Rivera',
  );
  expect(screen.getByText(record.provider)).toBeTruthy();
  expect(screen.getByText(record.kind)).toBeTruthy();
  unmount();

  render(<RecordCardContent record={record} />);
  expect(screen.getByText(record.title)).toBeTruthy();
  expect(screen.queryByText(/Samantha Wells/)).toBeNull();
  expect(screen.queryByText(/Alex Rivera/)).toBeNull();
});

test('record metadata handles sources that supply no participant names', () => {
  render(<RecordMetadata record={{ ...record, participantNames: [] }} />);
  expect(screen.getByText('Participants').nextElementSibling?.textContent).toBe('Not provided');
});
