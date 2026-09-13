export type Page<T> = {
  items: T[];
  total: number;
  nextOffset: number | null;
};

export function pageFrom<T>({
  items,
  total,
  offset,
}: {
  items: T[];
  total: number;
  offset: number;
}): Page<T> {
  const consumed = offset + items.length;
  return { items, total, nextOffset: consumed < total ? consumed : null };
}
