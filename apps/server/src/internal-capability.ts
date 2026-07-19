import { timingSafeEqual } from "node:crypto";

function sameCapability(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasInternalCapability(request: Request, expected: string): boolean {
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1] ?? "";
  return sameCapability(supplied, expected);
}

export function hasHeaderCapability(request: Request, header: string, expected: string): boolean {
  const supplied = request.headers.get(header)?.match(/^[A-Za-z0-9_-]{32,256}$/)?.[0] ?? "";
  return sameCapability(supplied, expected);
}
