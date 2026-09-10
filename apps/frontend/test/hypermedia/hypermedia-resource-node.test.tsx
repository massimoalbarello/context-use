import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HypermediaCanvas } from '../../src/components/hypermedia/hypermedia-canvas';
import type { HypermediaLayoutResource } from '../../src/components/hypermedia/hypermedia-layout';
import { HypermediaTimelineCanvas } from '../../src/components/hypermedia/hypermedia-temporal-canvas';
import { KnowledgeWorkspace } from '../../src/components/knowledge/knowledge-workspace';
import {
  calendarMonthLabel,
  currentCalendarMonth,
  shiftCalendarMonth,
} from '../../src/lib/calendar-month';

afterEach(cleanup);

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const portrait = {
  readableId: 'grace-portrait',
  name: 'Grace portrait',
  mediaType: 'image/png',
  extension: 'png',
  sizeBytes: 2_048,
  createdAt,
  updatedAt: createdAt,
};
const resources: HypermediaLayoutResource[] = [
  {
    key: 'entity:grace-hopper',
    kind: 'entity',
    entity: {
      readableId: 'grace-hopper',
      name: 'Grace Hopper',
      description: 'Computer scientist.',
      isSelf: false,
      image: portrait,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 0, y: 0 },
  },
  {
    key: 'entity:ada-lovelace',
    kind: 'entity',
    entity: {
      readableId: 'ada-lovelace',
      name: 'Ada Lovelace',
      description: 'Mathematician.',
      isSelf: false,
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 180, y: 0 },
  },
  {
    key: 'asset:system-diagram',
    kind: 'asset',
    asset: {
      readableId: 'system-diagram',
      name: 'System diagram',
      mediaType: 'image/webp',
      extension: 'webp',
      sizeBytes: 4_096,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 360, y: 0 },
  },
  {
    key: 'asset:project-brief',
    kind: 'asset',
    asset: {
      readableId: 'project-brief',
      name: 'Project brief',
      mediaType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 8_192,
      createdAt,
      updatedAt: createdAt,
    },
    point: { x: 540, y: 0 },
  },
];

type InteractiveRole = 'button' | 'link';

function resourceMark({
  role,
  name,
  kind,
}: {
  role: InteractiveRole;
  name: string;
  kind: 'entity' | 'asset';
}): SVGGElement {
  const accessibleName = role === 'link' ? `Open ${kind} ${name}` : name;
  const interactive = screen.getByRole(role, { name: accessibleName });
  const mark = interactive.querySelector<SVGGElement>(`[data-hypermedia-resource-kind="${kind}"]`);
  expect(mark).toBeTruthy();
  return mark!;
}

function expectResourceIdentities(role: InteractiveRole) {
  const grace = resourceMark({ role, name: 'Grace Hopper', kind: 'entity' });
  const ada = resourceMark({ role, name: 'Ada Lovelace', kind: 'entity' });
  const diagram = resourceMark({ role, name: 'System diagram', kind: 'asset' });
  const brief = resourceMark({ role, name: 'Project brief', kind: 'asset' });

  expect(grace.querySelector('circle')).toBeTruthy();
  expect(grace.querySelector('rect')).toBeNull();
  expect(grace.querySelector('image')?.getAttribute('href')).toBe(
    '/api/assets/grace-portrait/content',
  );
  expect(grace.textContent).toContain('G');
  expect(ada.querySelector('circle')).toBeTruthy();
  expect(ada.querySelector('image')).toBeNull();
  expect(ada.textContent).toContain('A');

  expect(diagram.querySelector('rect')?.getAttribute('rx')).toBeTruthy();
  expect(diagram.querySelector('circle')).toBeNull();
  expect(diagram.querySelector('image')?.getAttribute('href')).toBe(
    '/api/assets/system-diagram/content',
  );
  expect(diagram.querySelector('svg.lucide-file-text')).toBeTruthy();
  expect(brief.querySelector('rect')?.getAttribute('rx')).toBeTruthy();
  expect(brief.querySelector('image')).toBeNull();
  expect(brief.querySelector('svg.lucide-file-text')).toBeTruthy();
}

function HypermediaMapFixture({
  onMonthChange,
}: {
  onMonthChange: (month?: `${number}-${string}`) => void;
}) {
  return (
    <KnowledgeWorkspace>
      <div />
      <HypermediaCanvas
        resources={resources}
        pages={[]}
        temporalExtent={{
          start: Date.parse('2025-01-01T00:00:00.000Z'),
          end: Date.parse('2026-12-31T00:00:00.000Z'),
        }}
        selectedResources={[{ kind: 'entity', readableId: 'grace-hopper' }]}
        onSelect={() => undefined}
        onViewportSettled={() => undefined}
        onMonthChange={onMonthChange}
        canExplore={false}
        isInitialLoading={false}
        neighborhoodError={null}
        onRetryNeighborhood={() => undefined}
      />
    </KnowledgeWorkspace>
  );
}

test('Map distinguishes resource identities and moves smoothly through consecutive months', () => {
  const onMonthChange = mock(() => undefined);
  render(<HypermediaMapFixture onMonthChange={onMonthChange} />);

  expectResourceIdentities('link');
  const canvas = screen.getByLabelText('Interactive Hypermedia');
  const interval = screen.getByRole('img', { name: 'Pages without a time interval' });
  const initialPosition = interval.style.top;

  expect(screen.queryByText('Undated')).toBeNull();

  fireEvent.wheel(canvas, { deltaY: 80 });
  expect(interval.style.top).not.toBe(initialPosition);
  expect(onMonthChange).not.toHaveBeenCalled();

  const present = currentCalendarMonth();
  fireEvent.wheel(canvas, { deltaY: 80 });
  expect(onMonthChange).toHaveBeenLastCalledWith(present);
  expect(
    screen.getByRole('img', { name: `Selected interval: ${calendarMonthLabel(present)}` }),
  ).toBeTruthy();

  fireEvent.wheel(canvas, { deltaY: 120 });
  fireEvent.wheel(canvas, { deltaY: 40 });
  expect(onMonthChange).toHaveBeenLastCalledWith(
    shiftCalendarMonth({ value: present, offset: -1 }),
  );
  expect(onMonthChange).toHaveBeenCalledTimes(2);
});

test('Map consumes pinch zoom before the browser can zoom the dashboard', () => {
  const onMonthChange = mock(() => undefined);
  render(<HypermediaMapFixture onMonthChange={onMonthChange} />);
  const canvas = screen.getByLabelText('Interactive Hypermedia');
  const pinch = new WheelEvent('wheel', { cancelable: true, deltaY: -80 });
  Object.defineProperty(pinch, 'ctrlKey', { value: true });

  expect(fireEvent(canvas, pinch)).toBe(false);
  expect(onMonthChange).not.toHaveBeenCalled();
});

test('Timeline uses the same entity and asset identities', () => {
  render(
    <KnowledgeWorkspace>
      <div />
      <HypermediaTimelineCanvas
        resources={resources}
        pages={[]}
        extent={{
          start: Date.parse('2025-01-01T00:00:00.000Z'),
          end: Date.parse('2026-01-01T00:00:00.000Z'),
        }}
        selectedResources={[]}
        onSelect={() => undefined}
        onDateRangeApply={() => undefined}
        onViewportSettled={() => undefined}
        hasNextPage={false}
        isFetchingNextPage={false}
        onDiscoverMorePages={() => undefined}
      />
    </KnowledgeWorkspace>,
  );

  expectResourceIdentities('button');
});
