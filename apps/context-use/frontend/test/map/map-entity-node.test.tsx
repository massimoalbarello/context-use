import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgeWorkspaceProvider } from '../../src/components/knowledge/knowledge-workspace';
import { MapCanvas } from '../../src/components/map/map-canvas';
import type { MapLayoutEntity } from '../../src/components/map/map-layout';
import type { MapSelection } from '../../src/components/map/map-selection';
import {
  type CalendarMonth,
  calendarMonthLabel,
  currentCalendarMonth,
  shiftCalendarMonth,
} from '../../src/lib/calendar-month';
import type { MapPage } from '../../src/queries/map';

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
  publishedAt: null,
  readableId: 'grace-portrait',
  name: 'Grace portrait',
  mediaType: 'image/png',
  extension: 'png',
  sizeBytes: 2_048,
  createdAt,
  updatedAt: createdAt,
};
const entities: MapLayoutEntity[] = [
  {
    key: 'entity:grace-hopper',
    entity: {
      publishedAt: null,
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
      publishedAt: null,
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
  const mark = interactive.querySelector<SVGGElement>('[data-map-entity-mark]');
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

function MapFixture({
  onMonthChange,
  onIntervalScrollingChange = () => undefined,
  month,
  selectedKey,
  pages = [],
  onSelect = () => undefined,
}: {
  onMonthChange: (month?: `${number}-${string}`) => void;
  onIntervalScrollingChange?: (scrolling: boolean) => void;
  month?: CalendarMonth;
  selectedKey?: string;
  pages?: MapPage[];
  onSelect?: (selection: MapSelection) => void;
}) {
  return (
    <KnowledgeWorkspaceProvider>
      <div />
      <MapCanvas
        entities={entities}
        pages={pages}
        selectedKey={selectedKey}
        month={month}
        onSelect={onSelect}
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

test('Page hover temporarily emphasizes its members and preserves selection over entities', async () => {
  const user = userEvent.setup();
  const pages: MapPage[] = entities.map(({ entity }) => ({
    publishedAt: null,
    readableId: `${entity.readableId}-biography`,
    title: `${entity.name} biography`,
    excerpt: entity.description,
    temporalCoverage: null,
    revisionNumber: 1,
    createdAt,
    updatedAt: createdAt,
    entities: [{ readableId: entity.readableId }],
  }));
  const onSelect = mock<(selection: MapSelection) => void>(() => undefined);
  const props = { pages, onSelect, onMonthChange: () => undefined };
  const { rerender } = render(<MapFixture {...props} />);
  const grace = screen.getByRole('link', { name: 'Open entity Grace Hopper' });
  const ada = screen.getByRole('link', { name: 'Open entity Ada Lovelace' });
  const gracePage = screen.getByRole('link', {
    name: 'Open knowledge page Grace Hopper biography',
  });
  const adaCloud = screen.getByRole('link', {
    name: 'Open knowledge page region Ada Lovelace biography',
  });
  const expectEmphasis = (opacities: string[]) => {
    expect([getComputedStyle(grace).opacity, getComputedStyle(ada).opacity]).toEqual(opacities);
  };

  expectEmphasis(['1', '1']);
  await user.hover(gracePage);
  expectEmphasis(['1', '0.5']);
  expect(getComputedStyle(ada).filter).toBe('grayscale(1)');
  await user.unhover(gracePage);
  expectEmphasis(['1', '1']);

  await user.click(gracePage);
  expect(onSelect).toHaveBeenLastCalledWith({ kind: 'page', readableId: pages[0]!.readableId });
  rerender(<MapFixture {...props} selectedKey={`page:${pages[0]!.readableId}`} />);
  await user.unhover(gracePage);
  expectEmphasis(['1', '0.5']);
  await user.hover(adaCloud);
  expectEmphasis(['0.5', '1']);
  await user.unhover(adaCloud);
  expectEmphasis(['1', '0.5']);

  await user.hover(ada);
  expectEmphasis(['1', '0.5']);
  await user.click(ada);
  expect(onSelect).toHaveBeenLastCalledWith({ kind: 'entity', readableId: 'ada-lovelace' });
  rerender(<MapFixture {...props} selectedKey="entity:ada-lovelace" />);
  expectEmphasis(['1', '1']);
  rerender(<MapFixture {...props} selectedKey={`page:${pages[0]!.readableId}`} />);
  expectEmphasis(['1', '0.5']);
  rerender(<MapFixture {...props} />);
  expectEmphasis(['1', '1']);
});

test('Keyboard page focus emphasizes shared members and restores an unloaded selection', async () => {
  const user = userEvent.setup();
  const page: MapPage = {
    publishedAt: null,
    readableId: 'pioneers',
    title: 'Computing pioneers',
    excerpt: 'Shared history.',
    temporalCoverage: null,
    revisionNumber: 1,
    createdAt,
    updatedAt: createdAt,
    entities: entities.map(({ entity }) => ({ readableId: entity.readableId })),
  };
  const props = { onMonthChange: () => undefined, selectedKey: 'page:unloaded-page' };
  const { rerender } = render(<MapFixture {...props} pages={[page]} />);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('link', { name: 'Open knowledge page Computing pioneers' }),
  );
  for (const name of ['Grace Hopper', 'Ada Lovelace']) {
    expect(
      getComputedStyle(screen.getByRole('link', { name: `Open entity ${name}` })).opacity,
    ).toBe('1');
  }
  await user.tab();
  rerender(<MapFixture {...props} pages={[{ ...page, entities: [] }]} />);
  await user.tab({ shift: true });
  for (const name of ['Grace Hopper', 'Ada Lovelace']) {
    expect(
      getComputedStyle(screen.getByRole('link', { name: `Open entity ${name}` })).opacity,
    ).toBe('0.5');
  }
  await user.tab();
  for (const name of ['Grace Hopper', 'Ada Lovelace']) {
    expect(
      getComputedStyle(screen.getByRole('link', { name: `Open entity ${name}` })).opacity,
    ).toBe('1');
  }
});

test('Small map scrolls move immediately and trackpad tails stay in the same gesture', async () => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  const onIntervalScrollingChange = mock(() => undefined);
  render(
    <MapFixture
      onMonthChange={onMonthChange}
      onIntervalScrollingChange={onIntervalScrollingChange}
    />,
  );
  expectEntityIdentities();
  const canvas = screen.getByLabelText('Interactive map');
  const present = currentCalendarMonth();
  const previousMonth = shiftCalendarMonth({ value: present, offset: -1 });

  fireEvent.wheel(canvas, { deltaY: 0 });
  expectSelectedMonth();
  expect(onIntervalScrollingChange).not.toHaveBeenCalled();
  fireEvent.wheel(canvas, { deltaY: 1 });
  expectSelectedMonth(present);
  expect(onIntervalScrollingChange).toHaveBeenLastCalledWith(true);
  fireEvent.wheel(canvas, { deltaY: 40 });
  fireEvent.wheel(canvas, { deltaY: 20 });
  expectSelectedMonth(present);
  expect(onMonthChange).not.toHaveBeenCalled();
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(present);
  expect(onIntervalScrollingChange).toHaveBeenLastCalledWith(false);

  fireEvent.wheel(canvas, { deltaY: 1 });
  expectSelectedMonth(previousMonth);
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith(previousMonth);

  fireEvent.wheel(canvas, { deltaY: -1 });
  expectSelectedMonth(present);
  fireEvent.wheel(canvas, { deltaY: 1 });
  expectSelectedMonth(previousMonth);
  fireEvent.wheel(canvas, { deltaY: -320 });
  expectSelectedMonth();
  fireEvent.wheel(canvas, { deltaY: -320 });
  expectSelectedMonth();
  await settleIntervalScroll();
  expect(onMonthChange.mock.calls).toEqual([[present], [previousMonth], [undefined]]);
});

test.each([
  { deltaY: 480, deltaMode: WheelEvent.DOM_DELTA_PIXEL },
  { deltaY: 30, deltaMode: WheelEvent.DOM_DELTA_LINE },
  { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE },
])('Large map scrolls move multiple months ($deltaMode)', async (input) => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  render(<MapFixture onMonthChange={onMonthChange} month="2025-01" />);
  const canvas = screen.getByLabelText('Interactive map');
  Object.defineProperty(canvas, 'clientHeight', { value: 480 });
  fireEvent.wheel(canvas, input);
  expectSelectedMonth('2024-10');
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-10');

  fireEvent.wheel(canvas, { deltaY: 80 });
  fireEvent.wheel(canvas, { deltaY: 80 });
  expectSelectedMonth('2024-09');
  fireEvent.wheel(canvas, { deltaY: 80 });
  expectSelectedMonth('2024-08');
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-08');
});

test('The month wheel navigates across year boundaries and resets pending canvas scrolling', async () => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  const user = userEvent.setup();
  render(<MapFixture onMonthChange={onMonthChange} month="2025-01" />);

  const canvas = screen.getByLabelText('Interactive map');
  const picker = screen.getByRole('spinbutton', { name: 'Selected month' });
  fireEvent.wheel(canvas, { deltaY: 120 });
  picker.focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expectSelectedMonth('2024-11'), { timeout: 3_000 });
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-11');

  await settleIntervalScroll();
  expectSelectedMonth('2024-11');
  onMonthChange.mockClear();

  fireEvent.wheel(canvas, { deltaY: 1 });
  expectSelectedMonth('2024-10');
  await settleIntervalScroll();
  expect(onMonthChange).toHaveBeenLastCalledWith('2024-10');

  fireEvent.wheel(picker, { deltaY: 80 });
  await waitFor(() => expectSelectedMonth('2024-09'));
  await settleIntervalScroll();
  expect(onMonthChange.mock.calls).toEqual([['2024-10'], ['2024-09']]);

  await user.keyboard('{ArrowUp}');
  await waitFor(() => expectSelectedMonth('2024-10'), { timeout: 3_000 });
});

test('The month wheel stops at Undated and follows external month changes', async () => {
  const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
  const user = userEvent.setup();
  const { rerender } = render(<MapFixture onMonthChange={onMonthChange} />);
  const picker = screen.getByRole('spinbutton', { name: 'Selected month' });
  picker.focus();
  await user.keyboard('{ArrowUp}');
  expectSelectedMonth();
  expect(onMonthChange).not.toHaveBeenCalled();

  await user.keyboard('{ArrowDown}');
  await waitFor(() => expectSelectedMonth(currentCalendarMonth()));
  await user.keyboard('{ArrowUp}');
  await waitFor(() => expectSelectedMonth());

  rerender(<MapFixture onMonthChange={onMonthChange} month="1999-01" />);
  expectSelectedMonth('1999-01');
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expectSelectedMonth('1998-12'));
});

test('On phones the month wheel opens from a compact control and stays synchronized with the map', async () => {
  const matchMedia = spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }));
  try {
    const user = userEvent.setup();
    const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
    const { rerender } = render(<MapFixture onMonthChange={onMonthChange} month="2025-01" />);
    expect(screen.queryByRole('spinbutton')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change month: January 2025' }));
    const picker = await screen.findByRole('spinbutton', { name: 'Selected month' });
    await waitFor(() => expect(document.activeElement).toBe(picker));
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expectSelectedMonth('2024-12'), { timeout: 3_000 });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Change month: December 2024' }),
    );

    const canvas = screen.getByLabelText('Interactive map');
    fireEvent.wheel(canvas, { deltaY: 120 });
    fireEvent.wheel(canvas, { deltaY: 40 });
    await settleIntervalScroll();
    await user.click(screen.getByRole('button', { name: 'Change month: November 2024' }));
    expectSelectedMonth('2024-11');
    rerender(
      <MapFixture
        onMonthChange={onMonthChange}
        month="2024-11"
        selectedKey="entity:grace-hopper"
      />,
    );
    expect(screen.queryByRole('navigation', { name: 'Time navigation' })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  } finally {
    cleanup();
    matchMedia.mockRestore();
  }
});

test.each(['Interactive map', 'Selected month'])(
  'Map consumes pinch zoom over %s before the browser can zoom the dashboard',
  (targetLabel) => {
    const onMonthChange = mock<(month?: CalendarMonth) => void>(() => undefined);
    render(<MapFixture onMonthChange={onMonthChange} />);
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
