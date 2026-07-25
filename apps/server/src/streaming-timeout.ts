export const LARGE_RESPONSE_IDLE_TIMEOUT_SECONDS = 120;

type RequestTimeoutServer = {
  timeout(request: Request, seconds: number): void;
};

export function extendLargeResponseIdleTimeout(
  server: RequestTimeoutServer | null | undefined,
  request: Request,
): void {
  server?.timeout(request, LARGE_RESPONSE_IDLE_TIMEOUT_SECONDS);
}
