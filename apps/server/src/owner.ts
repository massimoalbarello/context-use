import { config } from "./config.ts";

export const normalizedOwnerEmail = config.OWNER_EMAIL.trim().toLowerCase();

export function isVerifiedOwner(email: string | null | undefined, verified: boolean | null | undefined): boolean {
  return Boolean(verified && email?.trim().toLowerCase() === normalizedOwnerEmail);
}
