export function validateEntityName({ value }: { value: string }): string | undefined {
  return value.trim() ? undefined : 'Give this entity a name.';
}

export function validateEntityDescription({ value }: { value: string }): string | undefined {
  return value.trim() ? undefined : 'Add a short description that distinguishes this entity.';
}
