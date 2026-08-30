const MIN_DESCRIPTION_LENGTH = 20;

export function validateEntityName({ value }: { value: string }): string | undefined {
  return value.trim() ? undefined : 'Give this entity a name.';
}

export function validateEntityDescription({ value }: { value: string }): string | undefined {
  return value.trim().length >= MIN_DESCRIPTION_LENGTH
    ? undefined
    : 'Add at least a short sentence that distinguishes this entity.';
}
