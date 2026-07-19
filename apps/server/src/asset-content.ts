import type { ObjectStorage } from "./storage.ts";
import { AssetNotFoundError, contentDisposition, mayRenderInline } from "./storage.ts";
import { securityHeaders } from "./security.ts";

type AssetContent = {
  s3_object_key: string;
  filename: string;
  content_type: string;
  size_bytes: number | string;
};

type ParsedRange = { start: number; end: number } | "unsatisfiable" | undefined;

function inlineContentSecurityPolicy(contentType: string): string {
  const normalized = contentType.toLowerCase();
  const resourceDirective = normalized.startsWith("image/")
    ? "img-src 'self'"
    : normalized.startsWith("video/") || normalized.startsWith("audio/")
      ? "media-src 'self'"
      : null;
  return ["default-src 'none'", resourceDirective, "frame-ancestors 'self'"]
    .filter((directive): directive is string => directive !== null)
    .join("; ");
}

export function parseAssetRange(value: string | null, sizeBytes: number): ParsedRange {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || sizeBytes === 0) return "unsatisfiable";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    return { start: Math.max(0, sizeBytes - suffixLength), end: sizeBytes - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= sizeBytes || requestedEnd < start) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(requestedEnd, sizeBytes - 1) };
}

export async function assetContentResponse(
  request: Request,
  asset: AssetContent,
  storage: ObjectStorage,
  inline: boolean,
): Promise<Response> {
  const sizeBytes = Number(asset.size_bytes);
  const range = parseAssetRange(request.headers.get("range"), sizeBytes);
  const rendersInline = inline && mayRenderInline(asset.content_type);
  const responseSecurityHeaders = rendersInline
    ? {
        ...securityHeaders,
        // Top-level image/media navigation creates a browser-owned wrapper that
        // reloads this same URL. Permit only that same-origin subresource; the
        // nested request must still pass the route's authentication/publication gate.
        "content-security-policy": inlineContentSecurityPolicy(asset.content_type),
        "x-frame-options": "SAMEORIGIN",
      }
    : securityHeaders;
  const baseHeaders = {
    ...responseSecurityHeaders,
    "accept-ranges": "bytes",
    "content-type": asset.content_type,
    "content-disposition": contentDisposition(
      asset.filename,
      rendersInline,
    ),
  };
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${sizeBytes}` },
    });
  }

  try {
    const body = await storage.read(asset.s3_object_key, range);
    if (range) {
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-length": String(range.end - range.start + 1),
          "content-range": `bytes ${range.start}-${range.end}/${sizeBytes}`,
        },
      });
    }
    return new Response(body, {
      headers: { ...baseHeaders, "content-length": String(sizeBytes) },
    });
  } catch (error) {
    if (error instanceof AssetNotFoundError) {
      return Response.json(
        { error: "not_found", message: "Asset bytes not found" },
        { status: 404, headers: securityHeaders },
      );
    }
    throw error;
  }
}
