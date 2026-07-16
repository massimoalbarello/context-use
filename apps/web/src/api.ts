let csrfToken = "";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function refreshCsrf(): Promise<string> {
  const response = await fetch("/api/dashboard/csrf", { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, "session", "Dashboard session required");
  const body = await response.json() as { csrf_token: string };
  csrfToken = body.csrf_token;
  return csrfToken;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (mutating && !csrfToken) await refreshCsrf();
  const headers = new Headers(init.headers);
  if (mutating) {
    headers.set("content-type", "application/json");
    headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "request_failed", message: response.statusText })) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(response.status, error.error ?? "request_failed", error.message ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export async function uploadFile(url: string, file: File, headers: Record<string, string>): Promise<void> {
  const requestHeaders = new Headers(headers);
  if (new URL(url, window.location.href).origin === window.location.origin) {
    if (!csrfToken) await refreshCsrf();
    requestHeaders.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(url, { method: "PUT", body: file, headers: requestHeaders, credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "upload_failed", await response.text());
}
