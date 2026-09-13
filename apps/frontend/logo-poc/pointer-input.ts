import { makeStroke, type Point, type Shape } from './drawing';

const DRAG_THRESHOLD_PX = 6;
const HALF = 0.5;

export function installDrawing({
  canvas,
  horizontalHalfWidth,
  verticalHalfWidth,
  onChange,
  onHover,
}: {
  canvas: HTMLCanvasElement;
  horizontalHalfWidth: number;
  verticalHalfWidth: number;
  onChange: (shapes: readonly Shape[]) => void;
  onHover: (point?: Point) => void;
}) {
  const committed: Shape[] = [];
  let active: { id: number; from: Point; horizontal?: boolean; preview?: Shape } | undefined;
  const point = (event: PointerEvent): Point => {
    const bounds = canvas.getBoundingClientRect();
    const unit = Math.min(bounds.width, bounds.height);
    return [
      (event.clientX - bounds.left - bounds.width * HALF) / unit,
      (event.clientY - bounds.top - bounds.height * HALF) / unit,
    ];
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || active) {
      return;
    }
    active = { id: event.pointerId, from: point(event) };
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!event.isPrimary) {
      return;
    }
    const to = point(event);
    if (!active || event.pointerId !== active.id) {
      if (event.pointerType === 'mouse') {
        onHover(to);
      }
      return;
    }
    const dx = Math.abs(to[0] - active.from[0]);
    const dy = Math.abs(to[1] - active.from[1]);
    const bounds = canvas.getBoundingClientRect();
    if (active.horizontal === undefined) {
      if (Math.max(dx, dy) * Math.min(bounds.width, bounds.height) < DRAG_THRESHOLD_PX) {
        return;
      }
      active.horizontal = dx >= dy;
    }
    active.preview = makeStroke({
      from: active.from,
      to,
      horizontal: active.horizontal,
      index: committed.length,
      thickness: active.horizontal ? horizontalHalfWidth : verticalHalfWidth,
    });
    onChange([...committed, active.preview]);
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerId !== active?.id) {
      return;
    }
    if (event.type === 'pointerup') {
      move(event);
      if (active.preview) {
        committed.push(active.preview);
      }
    }
    active = undefined;
    onChange(committed);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  const leave = () => onHover(undefined);
  const listeners = {
    pointerdown: down,
    pointermove: move,
    pointerup: finish,
    pointercancel: finish,
    lostpointercapture: finish,
    pointerleave: leave,
  };
  for (const [name, handler] of Object.entries(listeners)) {
    canvas.addEventListener(name, handler as EventListener);
  }
  return () => {
    for (const [name, handler] of Object.entries(listeners)) {
      canvas.removeEventListener(name, handler as EventListener);
    }
  };
}
