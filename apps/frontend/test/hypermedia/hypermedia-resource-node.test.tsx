import { afterEach, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HypermediaCanvas } from '../../src/components/hypermedia/hypermedia-canvas';
import type { HypermediaLayoutResource } from '../../src/components/hypermedia/hypermedia-layout';
import { KnowledgeWorkspace } from '../../src/components/knowledge/knowledge-workspace';
import {
  type CalendarMonth,
  calendarMonthLabel,
  currentCalendarMonth,
  shiftCalendarMonth,
} from '../../src/lib/calendar-month';

afterEach(cleanup);

const INTERVAL_SETTLE_WAIT_MS = 160;
const MAX_RESPONSIVE_PINCH_WIDTH_RATIO = 0.72;

async function settleIntervalScroll() {
  // biome-ignore lint/nursery/useAwaitThenable: React act intentionally returns a thenable.
  await act(() => new Promise((resolve) => setTimeout(resolve, INTERVAL_SETTLE_WAIT_MS)));
}

function intervalIndicatorPosition(name: string): string {
  return screen.getByRole('img', { name }).style.getPropertyValue('--interval-position');
}

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
      entityType: null,
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
      entityType: null,
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

function resourceMark({ name, kind }: { name: string; kind: 'entity' | 'asset' }): SVGGElement {
  const interactive = screen.getByRole('link', { name: `Open ${kind} ${name}` });
  const mark = interactive.querySelector<SVGGElement>(`[data-hypermedia-resource-kind="${kind}"]`);
  expect(mark).toBeTruthy();
  return mark!;
}

function expectResourceIdentities() {
  const grace = resourceMark({ name: 'Grace Hopper', kind: 'entity' });
  const ada = resourceMark({ name: 'Ada Lovelace', kind: 'entity' });
  const diagram = resourceMark({ name: 'System diagram', kind: 'asset' });
  const brief = resourceMark({ name: 'Project brief', kind: 'asset' });

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
  onIntervalScrollingChange = () => undefined,
  month,
  selectedKey,
}: {
  onMonthChange: (month?: `${number}-${string}`) => void;
  onIntervalScrollingChange?: (scrolling: boolean) => void;
  month?: CalendarMonth;
  selectedKey?: string;
}) {
  return (
    <KnowledgeWorkspace>
      <div />
      <HypermediaCanvas
        resources={resources}
        pages={[]}
        selectedResources={[{ kind: 'entity', readableId: 'grace-hopper' }]}
        selectedKey={selectedKey}
        month={month}
        onSelect={() => undefined}
        onViewportSettled={() => undefined}
        onMonthChange={onMonthChange}
        onIntervalScrollingChange={onIntervalScrollingChange}
        canExplore={false}
        isInitialLoading={false}
        neighborhoodError={null}
        onRetryNeighborhood={() => undefined}
      />
    </KnowledgeWorkspace>
  );
}

test('Map distinguishes resource identities and retains partial progress between months', async () => {
  const onMonthChange = mock(() => undefined);
  const onIntervalScrollingChange = mock(() => undefined);
  render(
    <HypermediaMapFixture
      onMonthChange={onMonthChange}
      onIntervalScrollingChange={onIntervalScrollingChange}
    />,
  );

  expectResourceIdentities();
  const canvas = screen.getByLabelText('Interactive Hypermedia');

  expect(screen.getByText('Undated')).toBeTruthy();
  expect(screen.getByText('Now')).toBeTruthy();
  expect(screen.getByText('Past')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Pages without a time interval' })).toBeTruthy();
  const undatedPosition = intervalIndicatorPosition('Pages without a time interval');

  fireEvent.wheel(canvas, { deltaY: 40 });
  expect(onIntervalScrollingChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('img', { name: 'Pages without a time interval' })).toBeTruthy();
  expect(screen.getByText('Now')).toBeTruthy();
  expect(screen.getByText('Past')).toBeTruthy();
  const partialPosition = intervalIndicatorPosition('Pages without a time interval');
  await settleIntervalScroll();
  expect(onIntervalScrollingChange).toHaveBeenLastCalledWith(false);
  expect(intervalIndicatorPosition('Pages without a time interval')).toBe(partialPosition);
  expect(onMonthChange).not.toHaveBeenCalled();

  fireEvent.wheel(canvas, { deltaY: 40 });
  expect(screen.getByRole('img', { name: 'Pages without a time interval' })).toBeTruthy();
  expect(onMonthChange).not.toHaveBeenCalled();

  fireEvent.wheel(canvas, { deltaY: 80 });
  const present = currentCalendarMonth();
  expect(
    screen.getByRole('img', { name: `Selected interval: ${calendarMonthLabel(present)}` }),
  ).toBeTruthy();
  const presentPosition = intervalIndicatorPosition(
    `Selected interval: ${calendarMonthLabel(present)}`,
  );
  expect(onMonthChange).not.toHaveBeenCalled();
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(present);
  expect(screen.getByText('Past')).toBeTruthy();

  fireEvent.wheel(canvas, { deltaY: 120 });
  fireEvent.wheel(canvas, { deltaY: 40 });
  const previousMonth = shiftCalendarMonth({ value: present, offset: -1 });
  const previousPosition = intervalIndicatorPosition(
    `Selected interval: ${calendarMonthLabel(previousMonth)}`,
  );
  expect(previousPosition).not.toBe(presentPosition);
  expect(onMonthChange).toHaveBeenCalledTimes(1);
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(previousMonth);
  expect(onMonthChange).toHaveBeenCalledTimes(2);

  fireEvent.wheel(canvas, { deltaY: -120 });
  fireEvent.wheel(canvas, { deltaY: -40 });
  expect(
    screen.getByRole('img', { name: `Selected interval: ${calendarMonthLabel(present)}` }),
  ).toBeTruthy();
  await settleIntervalScroll();

  fireEvent.wheel(canvas, { deltaY: -40 });
  expect(screen.getByRole('img', { name: 'Pages without a time interval' })).toBeTruthy();
  expect(screen.getByText('Undated')).toBeTruthy();
  expect(intervalIndicatorPosition('Pages without a time interval')).not.toBe(undatedPosition);
  expect(screen.getByText('Now')).toBeTruthy();
  expect(screen.getByText('Past')).toBeTruthy();
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(undefined);

  fireEvent.wheel(canvas, { deltaY: -120 });
  await settleIntervalScroll();
  expect(screen.getByText('Undated')).toBeTruthy();
  expect(screen.getByText('Now')).toBeTruthy();
  expect(screen.getByText('Past')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Pages without a time interval' })).toBeTruthy();
  expect(intervalIndicatorPosition('Pages without a time interval')).toBe(undatedPosition);
  expect(screen.queryByRole('img', { name: /Selected interval:/ })).toBeNull();
});

test('Map keeps the indicator at Past while older month labels continue changing', async () => {
  const onMonthChange = mock(() => undefined);
  const oldMonth = shiftCalendarMonth({ value: currentCalendarMonth(), offset: -24 });
  render(<HypermediaMapFixture onMonthChange={onMonthChange} month={oldMonth} />);

  const canvas = screen.getByLabelText('Interactive Hypermedia');
  const oldPosition = intervalIndicatorPosition(
    `Selected interval: ${calendarMonthLabel(oldMonth)}`,
  );
  fireEvent.wheel(canvas, { deltaY: 120 });
  fireEvent.wheel(canvas, { deltaY: 40 });
  const olderMonth = shiftCalendarMonth({ value: oldMonth, offset: -1 });

  expect(
    screen.getByRole('img', { name: `Selected interval: ${calendarMonthLabel(olderMonth)}` }),
  ).toBeTruthy();
  expect(intervalIndicatorPosition(`Selected interval: ${calendarMonthLabel(olderMonth)}`)).toBe(
    oldPosition,
  );
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(olderMonth);
});

test('Map hides the interval indicator while a detail card is open', () => {
  const present = currentCalendarMonth();
  render(
    <HypermediaMapFixture
      onMonthChange={() => undefined}
      month={present}
      selectedKey="entity:grace-hopper"
    />,
  );

  expect(screen.queryByText(calendarMonthLabel(present))).toBeNull();
  expect(screen.queryByText('Now')).toBeNull();
  expect(screen.queryByText('Past')).toBeNull();
  expect(screen.queryByRole('img', { name: /Selected interval:/ })).toBeNull();
});

test('Map consumes pinch zoom before the browser can zoom the dashboard', () => {
  const onMonthChange = mock(() => undefined);
  render(<HypermediaMapFixture onMonthChange={onMonthChange} />);
  const canvas = screen.getByLabelText('Interactive Hypermedia');
  const initialWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
  const pinch = new WheelEvent('wheel', { cancelable: true, deltaY: -80 });
  Object.defineProperty(pinch, 'ctrlKey', { value: true });

  expect(fireEvent(canvas, pinch)).toBe(false);
  expect(onMonthChange).not.toHaveBeenCalled();
  const zoomedWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
  expect(zoomedWidth / initialWidth).toBeLessThan(MAX_RESPONSIVE_PINCH_WIDTH_RATIO);
});
