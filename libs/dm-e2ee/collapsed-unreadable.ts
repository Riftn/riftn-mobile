/** A single unreadable message still has its own time and message actions.
 * Only collapse adjacent unseen rows when there are at least two of them. */
export function collapsedUnreadableRows(rows: readonly { _id: string; undecryptable?: boolean }[], expanded: ReadonlySet<string>) {
  const counts = new Map<string, number>();
  let start = 0;
  while (start < rows.length) {
    let end = start;
    while (end < rows.length && rows[end].undecryptable && !expanded.has(rows[end]._id)) end++;
    if (end - start > 1) {
      counts.set(rows[start]._id, end - start);
      for (let index = start + 1; index < end; index++) counts.set(rows[index]._id, 0);
    }
    start = end > start ? end : start + 1;
  }
  return counts;
}
