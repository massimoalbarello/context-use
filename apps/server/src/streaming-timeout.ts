export const STREAMING_REQUEST_IDLE_TIMEOUT_SECONDS = 0;

type RequestTimeoutServer = {
  timeout(request: Request, seconds: number): void;
};

export function disableStreamingRequestIdleTimeout(
  server: RequestTimeoutServer | null | undefined,
  request: Request,
): void {
  server?.timeout(request, STREAMING_REQUEST_IDLE_TIMEOUT_SECONDS);
}
