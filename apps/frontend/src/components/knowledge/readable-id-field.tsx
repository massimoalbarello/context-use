import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '@repo/backend/knowledge-address';
import { Input } from '../ui/input';

export function validateReadableId({ value }: { value?: string }): string | undefined {
  return value && READABLE_ID_PATTERN.test(value)
    ? undefined
    : 'Use lowercase words separated by single hyphens.';
}

export function ReadableIdField({
  kind,
  value,
  conflictingReadableId,
  invalid,
  error,
  onBlur,
  onChange,
}: {
  kind: 'entity' | 'page';
  value: string;
  conflictingReadableId: string | null;
  invalid: boolean;
  error?: string;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const preview = value || conflictingReadableId || 'readable-id';

  return (
    <label className="field conflict-field" htmlFor={`${kind}-readable-id`}>
      <span>
        {conflictingReadableId ? 'Choose a distinct readable ID' : 'Choose a readable ID'}
      </span>
      <Input
        id={`${kind}-readable-id`}
        name="readableId"
        value={value}
        placeholder={conflictingReadableId ?? undefined}
        maxLength={MAX_READABLE_ID_LENGTH}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
      />
      <small>
        <code>
          context-use://{kind}/{preview}
        </code>{' '}
        is the permanent address.{' '}
        {conflictingReadableId
          ? 'Add a distinguishing word rather than a number when possible.'
          : 'Use short lowercase words separated by hyphens.'}
      </small>
      {error && <em role="alert">{error}</em>}
    </label>
  );
}
