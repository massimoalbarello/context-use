import { ENTITY_TYPE_LABELS, ENTITY_TYPES, type EntityType } from '@repo/backend/entity';
import { Field, FieldDescription, FieldLabel } from '../ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function EntityTypeField({
  value,
  onChange,
  onBlur,
}: {
  value: EntityType | null;
  onChange: (value: EntityType | null) => void;
  onBlur: () => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="entity-type">Type (optional)</FieldLabel>
      <Select<EntityType | 'untyped'>
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
      <FieldDescription>Leave untyped when none fits or you’re unsure.</FieldDescription>
    </Field>
  );
}
