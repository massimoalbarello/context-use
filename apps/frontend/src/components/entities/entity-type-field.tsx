import { ENTITY_TYPE_LABELS, ENTITY_TYPES, type EntityType } from '@repo/backend/entity';
import { Field, FieldDescription, FieldLabel } from '../ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function EntityTypeField({
  value,
  onChange,
  onBlur,
  readOnly = false,
}: {
  value: EntityType | null;
  onChange: (value: EntityType | null) => void;
  onBlur: () => void;
  readOnly?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="entity-type">{readOnly ? 'Type' : 'Type (optional)'}</FieldLabel>
      <Select<EntityType | 'untyped'>
        disabled={readOnly}
        value={value ?? 'untyped'}
        onValueChange={(next) => onChange(next === 'untyped' ? null : next)}
      >
        <SelectTrigger id="entity-type" className="w-full" onBlur={onBlur}>
          <SelectValue>{value ? ENTITY_TYPE_LABELS[value] : 'Untyped'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="untyped">Untyped</SelectItem>
          {ENTITY_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {ENTITY_TYPE_LABELS[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {readOnly
          ? 'Your own entity is always a person.'
          : 'Leave untyped when none fits or you’re unsure.'}
      </FieldDescription>
    </Field>
  );
}
