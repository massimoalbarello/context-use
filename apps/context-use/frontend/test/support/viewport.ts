/** Drive the browser visibility boundary explicitly in DOM-only tests. */
export function mockViewport() {
  const NativeObserver = globalThis.IntersectionObserver;
  const viewport = {
    automatic: true,
    enter: new Map<Element, () => void>(),
    restore() {
      globalThis.IntersectionObserver = NativeObserver;
      viewport.enter.clear();
    },
  };
  globalThis.IntersectionObserver = class extends NativeObserver {
    private marker: Element | undefined;
    // biome-ignore lint/complexity/useMaxParams: Match the browser's IntersectionObserver constructor.
    constructor(
      private readonly callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      super(callback, options);
    }
    override observe(target: Element) {
      this.marker = target;
      const enter = () =>
        this.callback(
          [
            {
              target,
              isIntersecting: true,
              intersectionRatio: 1,
              time: 0,
              rootBounds: null,
              boundingClientRect: target.getBoundingClientRect(),
              intersectionRect: target.getBoundingClientRect(),
            },
          ],
          this,
        );
      viewport.enter.set(target, enter);
      if (viewport.automatic) {
        queueMicrotask(enter);
      }
    }
    override disconnect() {
      if (this.marker) {
        viewport.enter.delete(this.marker);
      }
    }
  };
  return viewport;
}
