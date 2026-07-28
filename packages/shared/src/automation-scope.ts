/**
 * Automation write scopes.
 *
 * An automation's output belongs wherever that output's subject belongs: a
 * digest of a day in that day's diary folder, an enriched company page in
 * companies/. Location therefore cannot double as the permission boundary, so
 * each automation declares the paths it may write and the server enforces that
 * list instead.
 *
 * Patterns are resolved against the run being executed, never against wall
 * clock time, so a daily automation can only ever write the day it is running
 * for. That is strictly narrower than granting it a folder outright.
 */

export const AUTOMATION_SCOPE_MAX_PATTERNS = 16;
const MAX_SEGMENTS = 12;
const LITERAL_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;
const DATE_TOKEN = /\{(YYYY|MM|DD)\}/g;
const TEMPLATED_SEGMENT = /^(?:[a-z0-9_-]|\{(?:YYYY|MM|DD)\})+$/;

export const AUTOMATION_WRITE_SCOPE_DESCRIPTION =
  "Extra knowledge paths this automation may create or update, beyond its own automations/<automation_key>/ folder. "
  + "Segments are lowercase; `{YYYY}`, `{MM}` and `{DD}` are replaced with the date of the run being executed, in the automation's time zone, "
  + "so a daily automation can only write the day it runs for. `*` matches one segment and a trailing `**` matches the rest of a subtree. "
  + "Example: `about/diary/{YYYY}/{MM}/{DD}/services-digest` plus `about/diary/{YYYY}/{MM}/{DD}/log` to add its own link to that day's log.";

export class AutomationScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationScopeError";
  }
}

export function automationOwnFolder(automationKey: string): string {
  return `automations/${automationKey}`;
}

/** Throws AutomationScopeError when the pattern could not be enforced safely. */
export function assertWriteScopePattern(pattern: string): void {
  if (pattern !== pattern.trim() || !pattern.length) {
    throw new AutomationScopeError("Write scope patterns cannot be blank or padded");
  }
  if (pattern.startsWith("/") || pattern.endsWith("/") || pattern.includes("//")) {
    throw new AutomationScopeError(`Invalid write scope pattern: ${pattern}`);
  }
  const segments = pattern.split("/");
  if (segments.length > MAX_SEGMENTS) {
    throw new AutomationScopeError(`Write scope pattern is too deep: ${pattern}`);
  }
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") {
      if (!last) throw new AutomationScopeError("`**` is only allowed as the final segment");
      return;
    }
    if (segment === "*") return;
    if (!TEMPLATED_SEGMENT.test(segment)) {
      throw new AutomationScopeError(`Invalid write scope segment "${segment}" in ${pattern}`);
    }
  });
  // A wildcard first segment would grant most of the knowledge base in one
  // pattern, which is never what someone means to write down.
  const root = segments[0]!;
  if (!LITERAL_SEGMENT.test(root)) {
    throw new AutomationScopeError("Write scope patterns must start with a literal directory");
  }
  if (root === "automations") {
    throw new AutomationScopeError(
      "An automation already owns automations/<automation_key>/ and cannot be granted another automation's folder",
    );
  }
}

type RunDateParts = { YYYY: string; MM: string; DD: string };

export function runDateParts(occurrence: Date, timeZone: string): RunDateParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(occurrence);
  } catch {
    throw new AutomationScopeError(`Unknown time zone: ${timeZone}`);
  }
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { YYYY: read("year"), MM: read("month"), DD: read("day") };
}

export function resolveScopePattern(pattern: string, date: RunDateParts): string {
  return pattern.replace(DATE_TOKEN, (_match, token: keyof RunDateParts) => date[token]);
}

function matchesPattern(pattern: string, path: string): boolean {
  const patternSegments = pattern.split("/");
  const pathSegments = path.split("/");
  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index]!;
    if (segment === "**") {
      // Matches one or more remaining segments, never zero: a grant on
      // `about/notes/**` is a grant on the subtree, not on the folder page.
      return pathSegments.length > index;
    }
    if (index >= pathSegments.length) return false;
    if (segment === "*") continue;
    if (segment !== pathSegments[index]) return false;
  }
  return patternSegments.length === pathSegments.length;
}

export type ResolvedWriteScope = {
  automationKey: string;
  patterns: string[];
};

/**
 * Resolves the scope for one run. The automation's own folder is always
 * included, so an empty declared scope behaves exactly as it did before scopes
 * existed.
 */
export function resolveWriteScope(
  automationKey: string,
  declared: readonly string[],
  occurrence: Date,
  timeZone: string,
): ResolvedWriteScope {
  const date = runDateParts(occurrence, timeZone);
  return {
    automationKey,
    patterns: [
      `${automationOwnFolder(automationKey)}/**`,
      ...declared.map((pattern) => resolveScopePattern(pattern, date)),
    ],
  };
}

export function isWithinWriteScope(scope: ResolvedWriteScope, path: string): boolean {
  return scope.patterns.some((pattern) => matchesPattern(pattern, path));
}

export function assertWithinWriteScope(scope: ResolvedWriteScope, path: string): void {
  if (isWithinWriteScope(scope, path)) return;
  throw new AutomationScopeError(
    `${path} is outside this automation's write scope. Granted: ${scope.patterns.join(", ")}`,
  );
}
