export const ApiStatus = {
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
} as const;

export function apiErrorMessage({ value, status }: { value: unknown; status: number }): string {
  if (typeof value === 'object' && value !== null) {
    if ('error' in value && typeof value.error === 'string') {
      return value.error;
    }
    if ('message' in value && typeof value.message === 'string') {
      return value.message;
    }
  }
  return `Request failed with status ${status}`;
}

export class DuplicateResourceNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateResourceNameError';
  }
}
