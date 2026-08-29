// Two shapes arrive here: `{ error }` from the backend's own error handler, and Elysia's
// validation shape when a schema rejects a request before any handler runs.
type ApiErrorValue = { error: string } | { message?: string };

export const ApiStatus = {
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
} as const;

export function apiErrorMessage({
  value,
  status,
}: {
  value: ApiErrorValue;
  status: number;
}): string {
  if ('error' in value) {
    return value.error;
  }
  return value.message ?? `Request failed with status ${status}`;
}

export class ReadableIdConflictError extends Error {
  readonly readableId: string;

  constructor({ message, readableId }: { message: string; readableId: string }) {
    super(message);
    this.name = 'ReadableIdConflictError';
    this.readableId = readableId;
  }
}

export class ReadableIdRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadableIdRequiredError';
  }
}
