/** Comparable text form for paths, display names, and QA answers. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    // Typographic forms of characters that are part of a token rather than punctuation.
    // "2-3×" and "2-3x" are the same fact, and dropping the sign entirely would leave
    // "2 3" against "2 3x" and read as a different claim.
    .replace(/\u00d7/g, "x")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
