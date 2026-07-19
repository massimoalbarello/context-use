import { timingSafeEqual } from "node:crypto";

export function hasInternalCapability(request: Request, expected: string): boolean {
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1] ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
