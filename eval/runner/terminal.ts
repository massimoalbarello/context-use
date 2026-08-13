/**
 * Terminal presentation for evaluation runs, which are watched live for tens of minutes.
 *
 * Colour is applied only when stdout is a terminal that wants it, so the same code paths
 * produce clean text in a redirected log or under `NO_COLOR`.
 */

const enabled = Boolean(process.stdout.isTTY)
  && !process.env.NO_COLOR
  && process.env.TERM !== "dumb";

function paint(code: string): (text: string) => string {
  return (text: string) => (enabled ? `[${code}m${text}[0m` : text);
}

export const style = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
  heading: paint("1;36"),
};

/** Falls back to a conservative width so wrapped output stays readable when piped. */
export function terminalWidth(): number {
  return Math.max(60, Math.min(process.stdout.columns ?? 100, 120));
}

/** Wraps a comma-separated list under a hanging indent. */
export function wrapList(items: string[], indent: number, width = terminalWidth()): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    const candidate = current ? `${current}, ${item}` : item;
    if (current && indent + candidate.length > width) {
      lines.push(pad + current);
      current = item;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(pad + current);
  return lines;
}

/** Truncates on a character budget, leaving room for the ellipsis. */
export function truncate(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, Math.max(1, limit - 1))}…`;
}
