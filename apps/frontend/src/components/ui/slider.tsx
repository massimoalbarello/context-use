import { Slider as SliderPrimitive } from '@base-ui/react/slider';

export function Slider({
  value,
  min,
  max,
  step,
  disabled,
  label,
  onValueChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  label: string;
  onValueChange: (value: number) => void;
}) {
  return (
    <SliderPrimitive.Root
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(next) => onValueChange(Array.isArray(next) ? next[0]! : next)}
    >
      <SliderPrimitive.Control className="flex h-8 w-full touch-none select-none items-center">
        <SliderPrimitive.Track className="relative h-2 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={label}
            className="size-5 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:opacity-50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
