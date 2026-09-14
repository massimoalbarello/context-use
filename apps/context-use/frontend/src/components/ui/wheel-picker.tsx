import '@ncdai/react-wheel-picker/style.css';
import {
  WheelPicker as WheelPickerPrimitive,
  type WheelPickerProps,
  type WheelPickerValue,
  WheelPickerWrapper,
} from '@ncdai/react-wheel-picker';
import { cn } from '@repo/ui/class-names';
import { useEffect, useRef } from 'react';

export function WheelPicker<T extends WheelPickerValue>({
  label,
  classNames,
  ...props
}: Omit<WheelPickerProps<T>, 'defaultValue' | 'value'> & { label: string; value: T }) {
  const root = useRef<HTMLDivElement>(null);
  const selectedIndex = props.options.findIndex((option) => option.value === props.value);
  const selected = props.options[selectedIndex];
  const selectedText = selected?.textValue ?? String(selected?.label ?? props.value);

  useEffect(() => {
    // The primitive owns focus and keyboard input but does not yet forward ARIA attributes.
    const input = root.current?.querySelector('[data-rwp]');
    if (!input) {
      return;
    }
    input.setAttribute('role', 'spinbutton');
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-valuenow', String(selectedIndex));
    input.setAttribute('aria-valuetext', selectedText);
    input.querySelectorAll('ul').forEach((list) => {
      list.setAttribute('aria-hidden', 'true');
    });
  }, [label, selectedIndex, selectedText]);

  return (
    <div ref={root}>
      <WheelPickerWrapper>
        <WheelPickerPrimitive
          {...props}
          classNames={{
            optionItem: cn('text-muted-foreground tabular-nums', classNames?.optionItem),
            highlightWrapper: cn(
              'inset-ring inset-ring-border rounded-lg bg-background text-foreground data-rwp-focused:inset-ring-2 data-rwp-focused:inset-ring-ring',
              classNames?.highlightWrapper,
            ),
            highlightItem: cn('text-sm tabular-nums', classNames?.highlightItem),
          }}
        />
      </WheelPickerWrapper>
    </div>
  );
}
