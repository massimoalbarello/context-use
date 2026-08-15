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

export async function uploadAssetContent(assetId: string, file: File, contentType: string): Promise<void> {
  if (!csrfToken) await refreshCsrf();
  const response = await fetch(`/api/dashboard/assets/${assetId}/content`, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "x-csrf-token": csrfToken,
    },
    body: file,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "upload_failed", message: response.statusText })) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(response.status, error.error ?? "upload_failed", error.message ?? response.statusText);
  }
}

// The server validates and stages the archive while it reads the request body, so
// bytes accepted by the server are a faithful measure of how far the import got.
// XMLHttpRequest is used instead of fetch because only it reports upload progress.
export async function uploadKnowledgeArchive<T>(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<T> {
  if (!csrfToken) await refreshCsrf();
  return new Promise<T>((resolve, reject) => {
    const parseBody = (text: string) => {
      try {
        return JSON.parse(text) as { error?: string; message?: string };
      } catch {
        return {};
      }
    };
    const request = new XMLHttpRequest();
    request.open("POST", "/api/dashboard/knowledge-import-intents");
    request.withCredentials = true;
    request.setRequestHeader("content-type", "application/zip");
    request.setRequestHeader("x-csrf-token", csrfToken);
    request.upload.addEventListener("progress", (event) => {
      onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size);
    });
    // The last progress event can land short of the end; the upload is only over here.
    request.upload.addEventListener("load", () => onProgress?.(file.size, file.size));
    request.addEventListener("load", () => {
      const body = parseBody(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        resolve(body as T);
        return;
      }
      reject(new ApiError(
        request.status,
        body.error ?? "upload_failed",
        body.message ?? request.statusText ?? "The archive could not be uploaded",
      ));
    });
    request.addEventListener("error", () => reject(
      new ApiError(0, "upload_failed", "The archive upload lost its connection to Context Use"),
    ));
    request.addEventListener("abort", () => reject(
      new ApiError(0, "upload_aborted", "The archive upload was cancelled"),
    ));
    request.send(file);
  });
}
