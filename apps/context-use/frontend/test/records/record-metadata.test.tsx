import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { RecordMetadata } from '../../src/components/records/record-detail';
import type { ContextRecord } from '../../src/queries/records';

afterEach(cleanup);

const record: ContextRecord = {
  readableId: 'meeting-a1b2c3',
  title: 'Project review',
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  createdAt: new Date('2026-09-09T11:00:00.000Z'),
  updatedAt: new Date('2026-09-09T12:00:00.000Z'),
  body: 'Discussion notes.',
  backlinks: [],
  source: { provider: 'granola', kind: 'meeting', id: 'source-meeting', url: null },
  occurredAt: null,
};

test('record metadata shows source identity and occurrence separately from ingestion dates', () => {
  render(<RecordMetadata record={{ ...record, occurredAt: '2001-01-09T13:00:00.000Z' }} />);
  expect(screen.getByText(record.source.provider)).toBeTruthy();
  expect(screen.getByText(record.source.kind)).toBeTruthy();
  expect(screen.getByText('Occurred at').nextElementSibling?.querySelector('time')?.dateTime).toBe(
    '2001-01-09T13:00:00.000Z',
  );
  expect(screen.queryByText('Participants')).toBeNull();
});
