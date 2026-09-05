import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '../../lib/class-names';

function Slider<Value extends number | readonly number[]>({
  className,
  ...props
}: SliderPrimitive.Root.Props<Value>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative w-full', className)}
      {...props}
    />
  );
}

function SliderControl({ className, ...props }: SliderPrimitive.Control.Props) {
  return (
    <SliderPrimitive.Control
      data-slot="slider-control"
      className={cn('flex w-full touch-none select-none items-center py-3', className)}
      {...props}
    />
  );
}

function SliderTrack({ className, ...props }: SliderPrimitive.Track.Props) {
  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={cn('h-1.5 w-full rounded-full bg-muted', className)}
      {...props}
    />
  );
}

function SliderIndicator({ className, ...props }: SliderPrimitive.Indicator.Props) {
  return (
    <SliderPrimitive.Indicator
      data-slot="slider-indicator"
      className={cn('rounded-full bg-foreground', className)}
      {...props}
    />
  );
}

function SliderThumb({ className, ...props }: SliderPrimitive.Thumb.Props) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        'size-4 rounded-full border-2 border-foreground bg-background shadow-sm transition-shadow disabled:pointer-events-none disabled:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2',
        className,
      )}
      {...props}
    />
  );
}

export { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack };
