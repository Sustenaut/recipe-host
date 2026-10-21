// Turns the V8 coverage Chromium reports for a script (Playwright's
// page.coverage) into LCOV line records, so the app's code, which only runs
// in the browser, counts in the coverage report next to the unit tests'.

// `entries` are coverage entries for one script, one per page load; `file`
// is the path the report names. A line counts as run if any load ran its
// first statement.
export function v8ToLcov(entries, file) {
  const source = entries[0].source;
  const hits = new Map();
  for (const entry of entries) {
    // Ranges nest: sorted by start, and outer before inner at the same
    // start, the last range holding an offset is the innermost and its
    // count is that offset's.
    const ranges = entry.functions.flatMap((f) => f.ranges)
      .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    let offset = 0;
    source.split('\n').forEach((text, n) => {
      const at = offset + text.search(/\S/);
      offset += text.length + 1;
      if (!/\S/.test(text) || /^\s*(\/\/|\/\*|\*)/.test(text)) return;
      const count = ranges.findLast((r) => r.startOffset <= at && at < r.endOffset)?.count ?? 0;
      hits.set(n + 1, (hits.get(n + 1) ?? 0) + count);
    });
  }
  const lines = [...hits].map(([line, count]) => `DA:${line},${count}`);
  const found = hits.size;
  const hit = [...hits.values()].filter((c) => c > 0).length;
  return ['TN:', `SF:${file}`, ...lines, `LF:${found}`, `LH:${hit}`, 'end_of_record', ''].join('\n');
}
