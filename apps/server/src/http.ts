import {
  DirectoryNotEmptyError,
  DirectoryVersionConflictError,
  PublicationStateError,
  RootDirectoryDeletionError,
  VersionConflictError,
} from "@context-use/database";
import { z } from "zod";
import { SecurityError, securityHeaders } from "./security.ts";

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { ...securityHeaders, ...headers } });
}

export function problem(message: string, status = 400, code = "bad_request"): Response {
  return json({ error: code, message }, status);
}

export async function bodyJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 2_100_000) throw new SecurityError("Request body too large", 413);
  return request.json();
}

export function routeError(error: unknown): Response {
  if (error instanceof SecurityError) return problem(error.message, error.status, "security_error");
  if (error instanceof VersionConflictError) {
    return json({ error: "version_conflict", current_version_number: error.currentVersion }, 409);
  }
  if (error instanceof DirectoryVersionConflictError) {
    return json({ error: "version_conflict", current_version_number: error.currentVersion }, 409);
  }
  if (error instanceof DirectoryNotEmptyError) {
    return json({ error: "directory_not_empty", message: error.message, contents: error.contents }, 409);
  }
  if (error instanceof RootDirectoryDeletionError) {
    return problem(error.message, 409, "directory_protected");
  }
  if (error instanceof PublicationStateError) return problem(error.message, 409, "publication_state");
  if (error instanceof z.ZodError) return json({ error: "validation_error", issues: error.issues }, 422);
  if (error instanceof Error && "code" in error) {
    const code = String((error as Error & { code: unknown }).code);
    if (code === "23505") return problem("A unique value is already in use", 409, "conflict");
    if (code === "23503") return problem("Create the parent directory metadata first", 422, "knowledge_parent_missing");
    if (code === "42501") return problem("Operation denied by the database security policy", 403, "forbidden");
    if (code === "23514") return problem("Write violates a knowledge ownership boundary", 422, "ownership_boundary");
    if (code === "P0002") return problem("Requested action not found", 404, "not_found");
    if (code === "22023") return problem("Requested action is expired or invalid", 409, "intent_inactive");
    if (code === "40001") return problem("Security state changed; begin confirmation again", 409, "security_state_changed");
    if (code === "55000") return problem("Knowledge imports require a fresh Context Use instance", 409, "import_requires_fresh_instance");
  }
  console.error("request_failed", error instanceof Error ? { name: error.name, message: error.message } : { type: typeof error });
  return problem("Internal server error", 500, "internal_error");
}
