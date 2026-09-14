import { afterEach, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    screen.getByRole('spinbutton', { name: 'Selected month' }).getAttribute('aria-valuetext'),
  ).toBe(calendarMonthLabel(month));
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

  fireEvent.wheel(canvas, { deltaY: 120 });
  fireEvent.wheel(canvas, { deltaY: 40 });
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

  fireEvent.wheel(canvas, { deltaY: -120 });
  await settleIntervalScroll();
  expectSelectedMonth();
  expect(onMonthChange.mock.calls).toEqual([[present], [previousMonth], [present], [undefined]]);
});

test('The month wheel navigates across year boundaries and resets pending canvas scrolling', async () => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  const user = userEvent.setup();
  render(<HypermediaMapFixture onMonthChange={onMonthChange} month="2025-01" />);

  const canvas = screen.getByLabelText('Interactive map');
  const picker = screen.getByRole('spinbutton', { name: 'Selected month' });
  fireEvent.wheel(canvas, { deltaY: 120 });
  picker.focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expectSelectedMonth('2024-12'), { timeout: 3_000 });
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-12');
  expect(onMonthChange).toHaveBeenCalledTimes(1);

  fireEvent.wheel(canvas, { deltaY: 40 });
  await settleIntervalScroll();
  expectSelectedMonth('2024-12');
  expect(onMonthChange).toHaveBeenCalledTimes(1);

  fireEvent.wheel(picker, { deltaY: 80 });
  await waitFor(() => expectSelectedMonth('2024-11'));
  await settleIntervalScroll();
  expect(onMonthChange.mock.calls).toEqual([['2024-12'], ['2024-11']]);

  await user.keyboard('{ArrowUp}');
  await waitFor(() => expectSelectedMonth('2024-12'), { timeout: 3_000 });
});

test('The month wheel stops at Undated and follows external month changes', async () => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  const user = userEvent.setup();
  const { rerender } = render(<HypermediaMapFixture onMonthChange={onMonthChange} />);
  const picker = screen.getByRole('spinbutton', { name: 'Selected month' });
  picker.focus();
  await user.keyboard('{ArrowUp}');
  expectSelectedMonth();
  expect(onMonthChange).not.toHaveBeenCalled();

  await user.keyboard('{ArrowDown}');
  await waitFor(() => expectSelectedMonth(currentCalendarMonth()));
  await user.keyboard('{ArrowUp}');
  await waitFor(() => expectSelectedMonth());

  rerender(<HypermediaMapFixture onMonthChange={onMonthChange} month="1999-01" />);
  expectSelectedMonth('1999-01');
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expectSelectedMonth('1998-12'));
});

test.each(['Interactive map', 'Selected month'])(
  'Map consumes pinch zoom over %s before the browser can zoom the dashboard',
  (targetLabel) => {
    const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
    render(<HypermediaMapFixture onMonthChange={onMonthChange} />);
    const canvas = screen.getByLabelText('Interactive map');
    const initialWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
    const pinch = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -80 });
    Object.defineProperty(pinch, 'ctrlKey', { value: true });

    expect(fireEvent(screen.getByLabelText(targetLabel), pinch)).toBe(false);
    expect(onMonthChange).not.toHaveBeenCalled();
    const zoomedWidth = Number(canvas.getAttribute('viewBox')?.split(' ')[2]);
    expect(zoomedWidth / initialWidth).toBeLessThan(MAX_RESPONSIVE_PINCH_WIDTH_RATIO);
  },
);
