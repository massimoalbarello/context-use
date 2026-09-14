import { afterEach, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HypermediaCanvas } from '../../src/components/hypermedia/hypermedia-canvas';
import type { HypermediaLayoutEntity } from '../../src/components/hypermedia/hypermedia-layout';
import { KnowledgeWorkspaceProvider } from '../../src/components/knowledge/knowledge-workspace';
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

function expectSelectedMonth(month?: CalendarMonth) {
  expect(
    screen.getByRole('button', { name: calendarMonthLabel(month) }).getAttribute('aria-current'),
  ).toBe('true');
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
const entities: HypermediaLayoutEntity[] = [
  {
    key: 'entity:grace-hopper',
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
];

function entityMark(name: string): SVGGElement {
  const interactive = screen.getByRole('link', { name: `Open entity ${name}` });
  const mark = interactive.querySelector<SVGGElement>('[data-hypermedia-entity-mark]');
  expect(mark).toBeTruthy();
  return mark!;
}

function expectEntityIdentities() {
  const grace = entityMark('Grace Hopper');
  const ada = entityMark('Ada Lovelace');

  expect(grace.querySelector('circle')).toBeTruthy();
  expect(grace.querySelector('rect')).toBeNull();
  expect(grace.querySelector('image')?.getAttribute('href')).toBe(
    '/api/assets/grace-portrait/content',
  );
  expect(grace.textContent).toContain('G');
  expect(ada.querySelector('circle')).toBeTruthy();
  expect(ada.querySelector('image')).toBeNull();
  expect(ada.textContent).toContain('A');
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
    <KnowledgeWorkspaceProvider>
      <div />
      <HypermediaCanvas
        entities={entities}
        pages={[]}
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
    </KnowledgeWorkspaceProvider>
  );
}

test('Map distinguishes entity identities and retains partial progress between months', async () => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  const onIntervalScrollingChange = mock(() => undefined);
  render(
    <HypermediaMapFixture
      onMonthChange={onMonthChange}
      onIntervalScrollingChange={onIntervalScrollingChange}
    />,
  );

  expectEntityIdentities();
  const canvas = screen.getByLabelText('Interactive map');

  expectSelectedMonth();
  const present = currentCalendarMonth();
  const previousMonth = shiftCalendarMonth({ value: present, offset: -1 });
  const wheel = screen.getByRole('navigation', { name: 'Time navigation' });
  expect(
    within(wheel)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Undated', calendarMonthLabel(present), calendarMonthLabel(previousMonth)]);

  fireEvent.wheel(canvas, { deltaY: 40 });
  expect(onIntervalScrollingChange).toHaveBeenLastCalledWith(true);
  expectSelectedMonth();
  await settleIntervalScroll();
  expect(onIntervalScrollingChange).toHaveBeenLastCalledWith(false);
  expect(onMonthChange).not.toHaveBeenCalled();

  fireEvent.wheel(canvas, { deltaY: 40 });
  expectSelectedMonth();
  fireEvent.wheel(canvas, { deltaY: 80 });
  expectSelectedMonth(present);
  expect(onMonthChange).not.toHaveBeenCalled();
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(present);

  fireEvent.wheel(wheel, { deltaY: 120 });
  fireEvent.wheel(wheel, { deltaY: 40 });
  expectSelectedMonth(previousMonth);
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(previousMonth);

  fireEvent.wheel(canvas, { deltaY: -120 });
  fireEvent.wheel(canvas, { deltaY: -40 });
  expectSelectedMonth(present);
  await settleIntervalScroll();

  fireEvent.wheel(canvas, { deltaY: -40 });
  expectSelectedMonth();
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(undefined);

  fireEvent.wheel(wheel, { deltaY: -120 });
  await settleIntervalScroll();
  expectSelectedMonth();
  expect(onMonthChange.mock.calls).toEqual([[present], [previousMonth], [present], [undefined]]);
});

test('The month wheel navigates across year boundaries and resets a pending scroll on selection', async () => {
  const onMonthChange = mock(() => undefined);
  const user = userEvent.setup();
  render(<HypermediaMapFixture onMonthChange={onMonthChange} month="2025-01" />);

  const wheel = screen.getByRole('navigation', { name: 'Time navigation' });
  expect(
    within(wheel)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['March 2025', 'February 2025', 'January 2025', 'December 2024', 'November 2024']);
  fireEvent.wheel(wheel, { deltaY: 120 });
  await user.click(within(wheel).getByRole('button', { name: 'December 2024' }));
  expectSelectedMonth('2024-12');
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-12');
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenCalledTimes(1);

  fireEvent.wheel(wheel, { deltaY: 40 });
  await settleIntervalScroll();
  expectSelectedMonth('2024-12');
  expect(onMonthChange).toHaveBeenCalledTimes(1);
  fireEvent.wheel(wheel, { deltaY: 120 });
  await settleIntervalScroll();
  expectSelectedMonth('2024-11');
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-11');
});

test('Map consumes pinch zoom before the browser can zoom the dashboard', () => {
  const onMonthChange = mock(() => undefined);
  render(<HypermediaMapFixture onMonthChange={onMonthChange} />);
  const canvas = screen.getByLabelText('Interactive map');
  const initialWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
  const pinch = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -80 });
  Object.defineProperty(pinch, 'ctrlKey', { value: true });

  expect(fireEvent(canvas, pinch)).toBe(false);
  expect(onMonthChange).not.toHaveBeenCalled();
  const zoomedWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
  expect(zoomedWidth / initialWidth).toBeLessThan(MAX_RESPONSIVE_PINCH_WIDTH_RATIO);
});
