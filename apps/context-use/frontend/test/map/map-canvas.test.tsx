// biome-ignore-all lint/complexity/useMaxParams: Touch fixtures use pointer IDs and coordinate pairs.
// biome-ignore-all lint/style/noMagicNumbers: Coordinates exercise portrait SVG letterboxing and two-finger gestures.
import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KnowledgeWorkspaceProvider } from '../../src/components/knowledge/knowledge-workspace';
import { MapCanvas } from '../../src/components/map/map-canvas';

afterEach(cleanup);

function renderCanvas() {
  const onSelect = mock(() => undefined);
  render(
    <KnowledgeWorkspaceProvider>
      <MapCanvas
        entities={[
          {
            key: 'entity:owner',
            point: { x: 0, y: 0 },
            entity: {
              readableId: 'owner',
              name: 'Owner',
              description: 'The owner.',
              isSelf: true,
              entityType: null,
              image: null,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-01'),
            },
          },
        ]}
        pages={[]}
        onSelect={onSelect}
        onViewportSettled={() => undefined}
        onMonthChange={() => undefined}
        onIntervalScrollingChange={() => undefined}
        canExplore={false}
        isInitialLoading={false}
        neighborhoodError={null}
        onRetryNeighborhood={() => undefined}
      />
    </KnowledgeWorkspaceProvider>,
  );
  const canvas = screen.getByLabelText('Interactive map');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 400, 800);
  const captured = new Set<number>();
  canvas.setPointerCapture = (id) => captured.add(id);
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => captured.delete(id);
  const view = () => canvas.getAttribute('viewBox')!.split(' ').map(Number);
  return { canvas, view, onSelect };
}

function touch(pointerId: number, clientX: number, clientY: number) {
  return { pointerId, clientX, clientY, pointerType: 'touch', button: 0 };
}

test('two fingers zoom in and out, then one finger continues panning without a jump', () => {
  const { canvas, view, onSelect } = renderCanvas();
  const initial = view();
  fireEvent.pointerDown(canvas, touch(1, 100, 400));
  fireEvent.pointerDown(canvas, touch(2, 300, 400));
  fireEvent.pointerMove(canvas, touch(1, 50, 400));
  fireEvent.pointerMove(canvas, touch(2, 350, 400));
  expect(view()[2]).toBeCloseTo((initial[2]! * 2) / 3);
  fireEvent.pointerMove(canvas, touch(1, 100, 400));
  fireEvent.pointerMove(canvas, touch(2, 300, 400));
  expect(view()[2]).toBeCloseTo(initial[2]!);
  fireEvent.pointerUp(canvas, touch(2, 300, 400));
  const beforePan = view();
  fireEvent.pointerMove(canvas, touch(1, 100, 420));
  expect(view()[1]).toBeCloseTo(beforePan[1]! - (20 * beforePan[2]!) / 400);
  expect(view()[2]).toBe(beforePan[2]);
  fireEvent.pointerUp(canvas, touch(1, 100, 420));
  expect(onSelect).not.toHaveBeenCalled();
});

test('a pinch starting on an item suppresses its click, and cancellation allows the next tap', () => {
  const { canvas, view, onSelect } = renderCanvas();
  const item = screen.getByRole('link', { name: 'Open entity Owner' });
  const initial = view();
  fireEvent.pointerDown(item, touch(1, 100, 400));
  fireEvent.pointerDown(canvas, touch(2, 300, 400));
  fireEvent.lostPointerCapture(item, touch(1, 100, 400));
  fireEvent.pointerMove(canvas, touch(2, 350, 400));
  expect(view()[2]).toBeLessThan(initial[2]!);
  fireEvent.pointerCancel(canvas, touch(2, 350, 400));
  fireEvent.pointerCancel(canvas, touch(1, 100, 400));
  fireEvent.click(item, { detail: 1 });
  expect(onSelect).not.toHaveBeenCalled();
  const cancelled = view();
  fireEvent.pointerMove(canvas, touch(1, 200, 400));
  expect(view()).toEqual(cancelled);
  fireEvent.pointerDown(item, touch(3, 100, 400));
  fireEvent.pointerUp(item, touch(3, 100, 400));
  fireEvent.click(item, { detail: 1 });
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test('trackpad pinch anchors to the rendered map on portrait screens', () => {
  const { canvas, view } = renderCanvas();
  const initial = view();
  const anchorY = initial[1]! + initial[3]! / 2 + (100 * initial[2]!) / 400;
  const pinch = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40 });
  // Happy DOM's WheelEvent does not inherit the MouseEvent coordinates or modifiers.
  Object.defineProperties(pinch, {
    ctrlKey: { value: true },
    clientX: { value: 200 },
    clientY: { value: 500 },
  });
  fireEvent(canvas, pinch);
  expect(view()[2]).toBeLessThan(initial[2]!);
  expect(view()[1]! + view()[3]! / 2 + (100 * view()[2]!) / 400).toBeCloseTo(anchorY);
});
